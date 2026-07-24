import argparse
import glob
import os
import random
import sys

sys.path.insert(0, "/opt/comfyui/app")

import torch
import torch.nn.functional as F
from PIL import Image

import comfy.sd
import comfy.utils
from comfy.sd import CLIPType

MODELS_DIR = "/opt/comfyui/app/models"
LORA_TARGET_SUFFIXES = ("to_q", "to_k", "to_v", "to_out.0", "q_proj", "k_proj", "v_proj", "o_proj")

class LoRALinear(torch.nn.Module):
    def __init__(self, base, rank=8, alpha=8.0):
        super().__init__()
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)
        out_f, in_f = base.weight.shape[0], base.weight.shape[1]
        self.lora_a = torch.nn.Parameter(torch.randn(rank, in_f) * 0.01)
        self.lora_b = torch.nn.Parameter(torch.zeros(out_f, rank))
        self.scale = alpha / rank

    def forward(self, x):
        out = self.base(x)
        delta = F.linear(F.linear(x.float(), self.lora_a), self.lora_b) * self.scale
        return out + delta.to(out.dtype)

def inject_lora(diffusion_model, rank, alpha):
    wrapped = []
    for name, module in list(diffusion_model.named_modules()):
        if not any(name.endswith(suf) for suf in LORA_TARGET_SUFFIXES):
            continue
        if not hasattr(module, "weight") or module.weight.ndim != 2:
            continue
        parent_name, _, child_name = name.rpartition(".")
        parent = diffusion_model.get_submodule(parent_name) if parent_name else diffusion_model
        lw = LoRALinear(module, rank=rank, alpha=alpha)
        setattr(parent, child_name, lw)
        wrapped.append((name, lw))
    return wrapped

def load_image_tensor(path, resolution):
    img = Image.open(path).convert("RGB").resize((resolution, resolution), Image.LANCZOS)
    t = torch.from_numpy(__import__("numpy").array(img)).float() / 255.0
    return t.unsqueeze(0)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", choices=["sdxl", "anima"], required=True)
    ap.add_argument("--checkpoint", required=True, help="checkpoints/ filename (sdxl) or diffusion_models/ filename (anima)")
    ap.add_argument("--clip", default="qwen_3_06b_base.safetensors", help="anima only: text_encoders/ filename")
    ap.add_argument("--vae", default="qwen_image_vae.safetensors", help="anima only: vae/ filename")
    ap.add_argument("--images-dir", required=True)
    ap.add_argument("--n-images", type=int, default=2)
    ap.add_argument("--trigger-word", default="sks")
    ap.add_argument("--resolution", type=int, default=512)
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--rank", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    device = torch.device("cuda")

    if args.arch == "sdxl":
        ckpt_path = os.path.join(MODELS_DIR, "checkpoints", args.checkpoint)
        model_patcher, clip, vae, _ = comfy.sd.load_checkpoint_guess_config(ckpt_path, output_vae=True, output_clip=True)
    else:
        unet_path = os.path.join(MODELS_DIR, "diffusion_models", args.checkpoint)
        model_patcher = comfy.sd.load_diffusion_model(unet_path)
        clip_path = os.path.join(MODELS_DIR, "text_encoders", args.clip)
        clip = comfy.sd.load_clip([clip_path], clip_type=CLIPType.QWEN_IMAGE)
        vae_path = os.path.join(MODELS_DIR, "vae", args.vae)
        vae_sd = comfy.utils.load_torch_file(vae_path)
        vae = comfy.sd.VAE(sd=vae_sd)

    model = model_patcher.model.to(device)
    model.diffusion_model.train()
    for p in model.parameters():
        p.requires_grad_(False)

    wrapped = inject_lora(model.diffusion_model, args.rank, args.rank * 2.0)
    print(f"LoRA-wrapped {len(wrapped)} linear layers: {[n for n, _ in wrapped[:6]]}{'...' if len(wrapped) > 6 else ''}")
    trainable = [p for _, lw in wrapped for p in (lw.lora_a, lw.lora_b)]
    for p in trainable:
        p.data = p.data.to(device)
        p.requires_grad_(True)
    opt = torch.optim.AdamW(trainable, lr=args.lr)

    all_images = sorted(glob.glob(os.path.join(args.images_dir, "*.png")) + glob.glob(os.path.join(args.images_dir, "*.jpg")))
    picked = random.sample(all_images, min(args.n_images, len(all_images)))
    print(f"Training on: {picked}")

    latents = []
    for path in picked:
        pixels = load_image_tensor(path, args.resolution).to(device)
        with torch.no_grad():
            lat = vae.encode(pixels).to(device)
            lat = model.model_config.latent_format.process_in(lat)
        latents.append(lat)
    latents = torch.cat(latents, dim=0)

    tokens = clip.tokenize(args.trigger_word)
    cond_out = clip.encode_from_tokens(tokens, return_dict=True)
    cross_attn = cond_out["cond"].to(device)
    extra_kwargs = {}
    if args.arch == "sdxl":
        adm = model.encode_adm(pooled_output=cond_out["pooled_output"].to(device),
                                width=args.resolution, height=args.resolution,
                                target_width=args.resolution, target_height=args.resolution)
        if adm is not None:
            extra_kwargs["y"] = adm.to(device)
    else:
        extra_kwargs["t5xxl_ids"] = cond_out["t5xxl_ids"].to(device)
        extra_kwargs["t5xxl_weights"] = cond_out["t5xxl_weights"].to(device)

    sigmas = model.model_sampling.sigmas.to(device)
    for step in range(1, args.steps + 1):
        idx = random.randrange(len(sigmas))
        sigma = sigmas[idx].expand(latents.shape[0])
        noise = torch.randn_like(latents)
        x_noisy = model.model_sampling.noise_scaling(sigma, noise, latents)

        opt.zero_grad()
        cross_attn_b = cross_attn.expand(latents.shape[0], -1, -1)
        extra_b = {k: (v.expand(latents.shape[0], *v.shape[1:]) if torch.is_tensor(v) and v.shape[0] == 1 else v)
                   for k, v in extra_kwargs.items()}
        pred_x0 = model.apply_model(x_noisy, sigma, c_crossattn=cross_attn_b, **extra_b)
        loss = F.mse_loss(pred_x0.float(), latents.float())
        loss.backward()
        opt.step()
        print(f"step {step}/{args.steps} loss={loss.item():.4f}")

    state = {}
    for name, lw in wrapped:
        state[f"{name}.lora_a.weight"] = lw.lora_a.detach().cpu()
        state[f"{name}.lora_b.weight"] = lw.lora_b.detach().cpu()
    comfy.utils.save_torch_file(state, args.out)
    print(f"Wrote debug LoRA state dict ({len(state)} tensors) to {args.out}")

if __name__ == "__main__":
    main()
