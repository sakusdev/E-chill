import "./style.css";
import { ChillEngine } from "./music";

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const toggle = required<HTMLButtonElement>("#toggle");
const status = required<HTMLElement>("#status");
const orb = required<HTMLElement>("#orb");
const keyLabel = required<HTMLElement>("#key");
const bpmLabel = required<HTMLElement>("#bpm");
const chordLabel = required<HTMLElement>("#chord");
const energy = required<HTMLInputElement>("#energy");
const warmth = required<HTMLInputElement>("#warmth");
const variation = required<HTMLInputElement>("#variation");

let playing = false;
const engine = new ChillEngine(snapshot => {
  keyLabel.textContent = snapshot.key;
  bpmLabel.textContent = String(snapshot.bpm);
  chordLabel.textContent = snapshot.chord;
});

const updateSettings = (): void => {
  engine.setSettings({
    energy: Number(energy.value) / 100,
    warmth: Number(warmth.value) / 100,
    variation: Number(variation.value) / 100,
  });
};

[energy, warmth, variation].forEach(input => input.addEventListener("input", updateSettings));
updateSettings();

toggle.addEventListener("click", async () => {
  toggle.disabled = true;
  try {
    if (playing) {
      engine.stop();
      playing = false;
      toggle.textContent = "再生する";
      status.textContent = "停止中";
      orb.classList.remove("playing");
    } else {
      await engine.start();
      playing = true;
      toggle.textContent = "停止する";
      status.textContent = "生成を続けています";
      orb.classList.add("playing");
    }
  } finally {
    toggle.disabled = false;
  }
});
