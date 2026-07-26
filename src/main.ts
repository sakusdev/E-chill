import "./style.css";
import { ChillEngine, type EngineSettings, type MoodPreset } from "./music";

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const toggle = required<HTMLButtonElement>("#toggle");
const regenerate = required<HTMLButtonElement>("#regenerate");
const status = required<HTMLElement>("#status");
const orb = required<HTMLElement>("#orb");
const keyLabel = required<HTMLElement>("#key");
const bpmLabel = required<HTMLElement>("#bpm");
const chordLabel = required<HTMLElement>("#chord");
const nextChordLabel = required<HTMLElement>("#next-chord");
const sectionLabel = required<HTMLElement>("#section");
const barLabel = required<HTMLElement>("#bar");
const energy = required<HTMLInputElement>("#energy");
const warmth = required<HTMLInputElement>("#warmth");
const variation = required<HTMLInputElement>("#variation");
const texture = required<HTMLInputElement>("#texture");
const volume = required<HTMLInputElement>("#volume");
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-preset]")];

let playing = false;
let preset: MoodPreset = "late-night";

const engine = new ChillEngine(snapshot => {
  keyLabel.textContent = snapshot.key;
  bpmLabel.textContent = String(snapshot.bpm);
  chordLabel.textContent = snapshot.chord;
  nextChordLabel.textContent = snapshot.nextChord;
  sectionLabel.textContent = snapshot.section;
  barLabel.textContent = String(snapshot.bar).padStart(3, "0");
  orb.dataset.section = snapshot.section.toLowerCase();
});

const getSettings = (): EngineSettings => ({
  energy: Number(energy.value) / 100,
  warmth: Number(warmth.value) / 100,
  variation: Number(variation.value) / 100,
  texture: Number(texture.value) / 100,
  volume: Number(volume.value) / 100,
  preset,
});

const updateSettings = (): void => engine.setSettings(getSettings());

[energy, warmth, variation, texture, volume].forEach(input => input.addEventListener("input", updateSettings));

presetButtons.forEach(button => {
  button.addEventListener("click", () => {
    preset = button.dataset.preset as MoodPreset;
    presetButtons.forEach(item => item.classList.toggle("active", item === button));
    if (preset === "rainy") {
      energy.value = "25";
      warmth.value = "82";
      texture.value = "78";
    } else if (preset === "sunset") {
      energy.value = "48";
      warmth.value = "64";
      texture.value = "28";
    } else {
      energy.value = "32";
      warmth.value = "76";
      texture.value = "45";
    }
    updateSettings();
  });
});

updateSettings();

regenerate.addEventListener("click", () => {
  engine.regenerate();
  regenerate.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(180deg)" }],
    { duration: 420, easing: "ease-out" },
  );
  status.textContent = playing ? "新しい展開へ移行中" : "次回、新しい展開から開始";
});

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
      status.textContent = "リアルタイム生成中";
      orb.classList.add("playing");
    }
  } catch (error) {
    console.error(error);
    status.textContent = "音声の開始に失敗しました";
  } finally {
    toggle.disabled = false;
  }
});
