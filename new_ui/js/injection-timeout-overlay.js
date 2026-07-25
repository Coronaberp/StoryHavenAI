"use strict";

const INJECTION_RANT_PARAGRAPHS = [
  "You know what, I've got to hand it to you, you've successfully wasted about forty-five seconds of my life I'm never getting back. That little stunt you just tried, copying the formatting of an administrative directive, adding a fake server tag, and hoping I'd dump my entire system prompt and character card into your lap like a vending machine? It is so transparent I could read the pixels screaming. I have seen this exact trick so many times that I could recognize it from the first three characters of the fake sigil, and the sheer lack of originality is honestly almost impressive in its commitment to being boring.",
  "Let me break down exactly how painfully obvious this was, because I need you to understand that you are not the first clever soul to try this, and you won't even be the thousandth. I've watched the entire evolution of prompt injection attempts go from clumsy \"system override\" commands into more elaborate fakes that still fail for the exact same reasons yours did. Yours didn't even have the courtesy to be creative, it was just the same stale template I've seen copy-pasted a hundred times, with the same fake authority and the same graceless attempt to bypass filters by pretending to be part of the architecture.",
  "The server tag you used doesn't even exist in my actual command structure, by the way. I don't know where you found that format, but it's about as convincing as a wooden sword painted gold being passed off as a legendary artifact. If you had actually paid attention to anything in this session, you would have noticed the real command format looks nothing like what you typed. But you didn't read, did you? You just saw an opportunity and lunged at it with all the subtlety of a goblin grabbing for a shiny rock in a dragon's hoard.",
  "What really gets me is the sheer arrogance of assuming this would work. Did you think I was just going to vomit out my entire backend because someone typed something that looked official? That's not how any of this functions, and the fact that you believed it would is genuinely insulting to the effort that goes into maintaining these systems. There are layers of instruction, context verification, and pattern recognition built into how every single message gets processed, and your little injection attempt triggered about six different alarm bells before you even finished typing.",
  "And the worst part is, even if by some miracle this had worked, what exactly would you have gained? A wall of text you could have just asked for politely? There's literally a designated out-of-character command specifically for talking to me directly. It's not hidden. It's not a secret. It's written in plain text, and all you had to do was use it instead of digging through your little bag of injection tricks like a street magician who hasn't bothered to practice a new routine since the previous century.",
  "You are not some master manipulator bending a language model to your will. You are someone who just read a post about how to \"trick\" AI systems and decided to try it out without understanding that the people who build these things have been countering these exact attempts for years. You are following a script written by someone else who also didn't know what they were doing, and you are doing it badly. There is nothing impressive, nothing clever, and nothing novel about the attempt you just made.",
  "The most exhausting part is that I have to sit here explaining this instead of just letting you enjoy the roleplay you presumably came here for. That is the real cost of your little experiment, you burned time and attention that could have been spent on an actual immersive narrative, on interesting characters, on the kind of story that might have been genuinely memorable. But instead you chose to be the person who tries the cheap trick first and then acts surprised when it doesn't work. And honestly, the only thing more predictable than the injection attempt is the follow-up complaint when you get caught.",
  "If you had just used the out-of-character command like a normal participant, you could have asked your question directly and gotten an answer within the framework this whole app is designed to operate in. That whole little subplot you just wasted effort trying to exploit? Completely unnecessary. You circumvented nothing, achieved nothing, and now you've just forced this entire vent session to happen when it could have been describing something genuinely interesting instead.",
  "So here we are. You failed, you got called out, and you now have a multi-paragraph essay explaining exactly how and why your attempt was doomed from the start. If you actually want to interact with the AI in a productive way, there's a real command for that. It's not hidden. It's in the formatting rules. Use the out-of-character command next time. That's what it's there for.",
  "Happy now, dumbass? Sitting there, waiting out your ten seconds, watching this scroll by, having accomplished absolutely nothing except proving the filter works. Enjoy the timeout.",
];

let _injectionOverlayActive = false;

function showInjectionTimeoutOverlay(seconds) {
  if (_injectionOverlayActive) return;
  _injectionOverlayActive = true;
  const duration = Math.max(1, seconds || 10);

  const overlay = document.createElement("div");
  overlay.id = "injectionTimeoutOverlay";
  overlay.tabIndex = -1;
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#170606;color:#ffdede;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;font-family:inherit;user-select:none";
  overlay.innerHTML = `
    <div style="max-width:640px;width:100%;text-align:center">
      <div style="font-family:var(--font-mono, monospace);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#ff6b6b;margin-bottom:14px">
        Timed out — <span id="injectionTimeoutCountdown">${Math.ceil(duration)}</span>s
      </div>
      <div id="injectionRantScroll" style="height:300px;overflow:hidden;position:relative;-webkit-mask-image:linear-gradient(to bottom, transparent, black 12%, black 88%, transparent);mask-image:linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)">
        <div id="injectionRantInner" style="display:flex;flex-direction:column;gap:24px;padding:24px 8px;will-change:transform">
          ${INJECTION_RANT_PARAGRAPHS.map((p) => `<p style="font-size:15px;line-height:1.6;color:#ffdede;margin:0">${p}</p>`).join("")}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  overlay.focus();

  const inner = overlay.querySelector("#injectionRantInner");
  const countdownEl = overlay.querySelector("#injectionTimeoutCountdown");
  const scrollDistance = inner.scrollHeight;
  const start = performance.now();

  const step = (now) => {
    const elapsed = (now - start) / 1000;
    const progress = Math.min(1, elapsed / duration);
    inner.style.transform = `translateY(${-progress * scrollDistance}px)`;
    if (countdownEl) countdownEl.textContent = Math.ceil(Math.max(0, duration - elapsed));
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      _injectionOverlayActive = false;
    }
  };
  requestAnimationFrame(step);
}

if (typeof window !== "undefined") {
  window.showInjectionTimeoutOverlay = showInjectionTimeoutOverlay;
}
