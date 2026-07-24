import pytest

from backend.imagegen_workflows import _build_inpaint_workflow, _build_anima_inpaint_workflow

def test_build_inpaint_workflow_wires_mask_and_image():
    wf = _build_inpaint_workflow(
        "a cat", "blurry", "model.safetensors", "photo.png", "mask.png", denoise=0.8)

    load_image = next(n for n in wf.values() if n["class_type"] == "LoadImage"
                      and n["inputs"]["image"] == "photo.png")
    load_mask = next(n for n in wf.values() if n["class_type"] == "LoadImageMask"
                     and n["inputs"]["image"] == "mask.png")
    encode = next(n for n in wf.values() if n["class_type"] == "VAEEncodeForInpaint")
    load_image_id = next(k for k, v in wf.items() if v is load_image)
    load_mask_id = next(k for k, v in wf.items() if v is load_mask)
    assert encode["inputs"]["pixels"] == [load_image_id, 0]
    assert encode["inputs"]["mask"] == [load_mask_id, 0]

    ksampler = next(n for n in wf.values() if n["class_type"] == "KSampler")
    assert ksampler["inputs"]["denoise"] == 0.8
    assert ksampler["inputs"]["positive"] is not None
    assert ksampler["inputs"]["negative"] is not None

    checkpoint_node = next(n for n in wf.values() if n["class_type"] == "CheckpointLoaderSimple")
    assert checkpoint_node["inputs"]["ckpt_name"] == "model.safetensors"

    save = next(n for n in wf.values() if n["class_type"] == "SaveImage")
    assert save is not None

def test_build_inpaint_workflow_rejects_blacklisted_checkpoint():
    with pytest.raises(ValueError):
        _build_inpaint_workflow(
            "a cat", "blurry", "prefect_illustrous_sdxl.safetensors",
            "photo.png", "mask.png")

def test_build_anima_inpaint_workflow_uses_unet_loader_not_checkpoint():
    wf = _build_anima_inpaint_workflow(
        "a cat", "blurry", "anima_unet.safetensors", "photo.png", "mask.png", denoise=0.8)

    assert not any(n["class_type"] == "CheckpointLoaderSimple" for n in wf.values())
    unet = next(n for n in wf.values() if n["class_type"] == "UNETLoader")
    assert unet["inputs"]["unet_name"] == "anima_unet.safetensors"

    vae_loader = next(k for k, v in wf.items() if v["class_type"] == "VAELoader")
    encode = next(n for n in wf.values() if n["class_type"] == "VAEEncodeForInpaint")
    assert encode["inputs"]["vae"] == [vae_loader, 0]

    ksampler = next(n for n in wf.values() if n["class_type"] == "KSampler")
    assert ksampler["inputs"]["denoise"] == 0.8

from backend.imagegen_workflows import _build_wan_video_workflow

def test_build_wan_video_workflow_text_to_video():
    wf = _build_wan_video_workflow(
        "a dog running", "blurry", "wan_unet.safetensors", "wan_clip.safetensors",
        "wan_vae.safetensors", fps=16, num_frames=33)
    assert not any(n["class_type"] == "LoadImage" for n in wf.values())
    unet = next(n for n in wf.values() if n["class_type"] == "UNETLoader")
    assert unet["inputs"]["unet_name"] == "wan_unet.safetensors"
    ksampler = next(n for n in wf.values() if n["class_type"] == "KSampler")
    assert ksampler is not None
    save = next(n for n in wf.values() if n["class_type"] == "SaveVideo")
    assert save["inputs"]["format"] and save["inputs"]["codec"]
