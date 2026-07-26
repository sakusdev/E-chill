export type MoodPreset = "late-night" | "rainy" | "sunset";
export type EngineSnapshot = {
  chord: string;
  nextChord: string;
  key: string;
  bpm: number;
  section: string;
  bar: number;
};

export type EngineSettings = {
  energy: number;
  warmth: number;
  variation: number;
  texture: number;
  volume: number;
  preset: MoodPreset;
};

type Chord = {
  name: string;
  degrees: number[];
  bass: number;
  next: Array<[number, number]>;
};

type Section = "intro" | "groove" | "bloom" | "break" | "return";

const CHORDS: Chord[] = [
  { name: "Cmaj9", degrees: [0, 4, 7, 11, 14], bass: 36, next: [[1, 2], [2, 4], [3, 4], [5, 2], [6, 2]] },
  { name: "C♯dim7", degrees: [1, 4, 7, 10], bass: 37, next: [[2, 10]] },
  { name: "Dm9", degrees: [2, 5, 9, 12, 16], bass: 38, next: [[3, 3], [5, 5], [6, 3], [7, 2]] },
  { name: "Fmaj9", degrees: [5, 9, 12, 16, 19], bass: 41, next: [[0, 4], [4, 5], [5, 2], [6, 2]] },
  { name: "Fm6", degrees: [5, 8, 12, 14], bass: 41, next: [[0, 10], [8, 2]] },
  { name: "G13sus", degrees: [7, 12, 14, 17, 21], bass: 43, next: [[0, 8], [4, 2]] },
  { name: "Am9", degrees: [9, 12, 16, 19, 23], bass: 45, next: [[2, 4], [3, 3], [5, 3], [7, 2]] },
  { name: "Gm9", degrees: [7, 10, 14, 17, 21], bass: 43, next: [[8, 9], [3, 2]] },
  { name: "C13", degrees: [0, 4, 10, 14, 21], bass: 36, next: [[3, 10], [4, 1]] },
  { name: "Em7/A", degrees: [4, 7, 11, 14], bass: 45, next: [[2, 5], [6, 4], [5, 2]] },
];

const SECTION_NAMES: Record<Section, string> = {
  intro: "INTRO",
  groove: "GROOVE",
  bloom: "BLOOM",
  break: "BREAK",
  return: "RETURN",
};

const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const random = (min: number, max: number): number => min + Math.random() * (max - min);
const choose = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

const weightedChoice = (items: Array<[number, number]>): number => {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = Math.random() * total;
  for (const [value, weight] of items) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return items.at(-1)![0];
};

export class ChillEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private textureBus: GainNode | null = null;
  private delay: DelayNode | null = null;
  private feedback: GainNode | null = null;
  private timer: number | null = null;
  private chordIndex = 0;
  private nextChordIndex = 2;
  private nextTime = 0;
  private bar = 0;
  private section: Section = "intro";
  private sectionBars = 0;
  private previousVoicing: number[] = [];
  private motif = [4, 7, 9, 7];
  private recentChords: number[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private settings: EngineSettings = {
    energy: 0.32,
    warmth: 0.76,
    variation: 0.38,
    texture: 0.45,
    volume: 0.72,
    preset: "late-night",
  };

  constructor(private readonly onSnapshot: (snapshot: EngineSnapshot) => void) {}

  setSettings(settings: EngineSettings): void {
    this.settings = settings;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(settings.volume * 0.42, this.context.currentTime, 0.05);
    }
    if (this.textureBus && this.context) {
      this.textureBus.gain.setTargetAtTime(settings.texture * 0.16, this.context.currentTime, 0.2);
    }
  }

  async start(): Promise<void> {
    if (this.context) return;
    this.context = new AudioContext();
    await this.context.resume();

    this.master = this.context.createGain();
    this.musicBus = this.context.createGain();
    this.textureBus = this.context.createGain();
    const compressor = this.context.createDynamicsCompressor();
    const masterFilter = this.context.createBiquadFilter();
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = 15000;
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.35;

    this.master.gain.value = this.settings.volume * 0.42;
    this.musicBus.gain.value = 1;
    this.textureBus.gain.value = this.settings.texture * 0.16;
    this.musicBus.connect(masterFilter);
    this.textureBus.connect(masterFilter);
    masterFilter.connect(compressor).connect(this.master).connect(this.context.destination);

    this.delay = this.context.createDelay(1.5);
    this.delay.delayTime.value = 0.32;
    this.feedback = this.context.createGain();
    this.feedback.gain.value = 0.2;
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.musicBus);

    this.noiseBuffer = this.makeNoiseBuffer(4);
    this.startTexture();
    this.nextTime = this.context.currentTime + 0.08;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.textureBus = null;
    this.noiseBuffer = null;
  }

  regenerate(): void {
    this.motif = this.createMotif();
    this.nextChordIndex = weightedChoice(CHORDS[this.chordIndex]!.next);
    this.section = "bloom";
    this.sectionBars = 0;
  }

  private schedule(): void {
    if (!this.context) return;
    const presetOffset = this.settings.preset === "sunset" ? 4 : this.settings.preset === "rainy" ? -3 : 0;
    const bpm = Math.round(66 + this.settings.energy * 20 + presetOffset);
    const beat = 60 / bpm;
    while (this.nextTime < this.context.currentTime + 1.5) {
      this.scheduleBar(this.nextTime, beat);
      this.nextTime += beat * 4;
    }
  }

  private scheduleBar(time: number, beat: number): void {
    const chord = CHORDS[this.chordIndex]!;
    const nextChord = CHORDS[this.nextChordIndex]!;
    this.onSnapshot({
      chord: chord.name,
      nextChord: nextChord.name,
      key: "C major / A minor",
      bpm: Math.round(60 / beat),
      section: SECTION_NAMES[this.section],
      bar: this.bar + 1,
    });

    const voicing = this.chooseVoicing(chord);
    const sectionDensity = this.section === "intro" ? 0.55 : this.section === "break" ? 0.35 : this.section === "bloom" ? 1.12 : 1;
    this.playPad(voicing, time, beat * 3.92, sectionDensity);
    this.playBassLine(chord, nextChord, time, beat, sectionDensity);
    this.playMotif(chord, time, beat, sectionDensity);
    this.playPercussion(time, beat, sectionDensity);

    this.previousVoicing = voicing;
    this.bar += 1;
    this.sectionBars += 1;
    this.advanceForm();
    this.advanceHarmony();
  }

  private advanceHarmony(): void {
    this.chordIndex = this.nextChordIndex;
    const chord = CHORDS[this.chordIndex]!;
    let candidates = chord.next;
    if (this.recentChords.slice(-3).includes(this.chordIndex)) {
      candidates = candidates.map(([index, weight]) => [index, index === this.chordIndex ? weight * 0.1 : weight] as [number, number]);
    }
    if (Math.random() < this.settings.variation * 0.12) {
      candidates = [...candidates, [Math.floor(Math.random() * CHORDS.length), 1]];
    }
    this.nextChordIndex = weightedChoice(candidates);
    this.recentChords.push(this.chordIndex);
    this.recentChords = this.recentChords.slice(-12);
  }

  private advanceForm(): void {
    const limits: Record<Section, number> = { intro: 4, groove: 8, bloom: 4, break: 4, return: 8 };
    if (this.sectionBars < limits[this.section]) return;
    const transitions: Record<Section, Section[]> = {
      intro: ["groove"],
      groove: ["groove", "bloom", "break"],
      bloom: ["return", "break"],
      break: ["return"],
      return: ["groove", "bloom", "break"],
    };
    this.section = choose(transitions[this.section]);
    this.sectionBars = 0;
    if (Math.random() < 0.65) this.motif = this.mutateMotif(this.motif);
  }

  private chooseVoicing(chord: Chord): number[] {
    const candidates: number[][] = [];
    for (let inversion = 0; inversion < chord.degrees.length; inversion += 1) {
      const notes = chord.degrees.map((degree, index) => 55 + degree + (index < inversion ? 12 : 0));
      for (const octave of [-12, 0, 12]) candidates.push(notes.map(note => note + octave).filter(note => note >= 48 && note <= 81));
    }
    if (!this.previousVoicing.length) return candidates.find(notes => notes.length >= 4) ?? candidates[0]!;
    return candidates.reduce((best, candidate) => {
      const cost = candidate.reduce((sum, note) => sum + Math.min(...this.previousVoicing.map(previous => Math.abs(previous - note))), 0)
        + Math.abs(candidate.length - this.previousVoicing.length) * 3;
      const bestCost = best.reduce((sum, note) => sum + Math.min(...this.previousVoicing.map(previous => Math.abs(previous - note))), 0)
        + Math.abs(best.length - this.previousVoicing.length) * 3;
      return cost < bestCost ? candidate : best;
    }, candidates[0]!);
  }

  private createMotif(): number[] {
    const palette = [0, 2, 4, 7, 9, 11, 14];
    const result = [choose(palette)];
    while (result.length < 4) {
      const previous = result.at(-1)!;
      const nearby = palette.filter(note => Math.abs(note - previous) <= 5);
      result.push(choose(nearby.length ? nearby : palette));
    }
    return result;
  }

  private mutateMotif(motif: number[]): number[] {
    const result = [...motif];
    const index = Math.floor(Math.random() * result.length);
    result[index] = clamp(result[index]! + choose([-2, -1, 1, 2]), -2, 16);
    if (Math.random() < this.settings.variation * 0.3) result.reverse();
    return result;
  }

  private playPad(notes: number[], time: number, duration: number, density: number): void {
    if (!this.context || !this.musicBus) return;
    const bus = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();
    filter.type = "lowpass";
    filter.frequency.value = 620 + (1 - this.settings.warmth) * 2400 + this.settings.energy * 350;
    filter.Q.value = 0.35;
    pan.pan.value = random(-0.12, 0.12);
    bus.gain.setValueAtTime(0.0001, time);
    bus.gain.exponentialRampToValueAtTime(0.055 * density, time + 0.3);
    bus.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    bus.connect(filter).connect(pan).connect(this.musicBus);
    if (this.delay) filter.connect(this.delay);

    notes.forEach((note, index) => {
      const osc = this.context!.createOscillator();
      const shimmer = this.context!.createOscillator();
      const shimmerGain = this.context!.createGain();
      osc.type = index % 2 ? "triangle" : "sine";
      osc.frequency.value = midiToHz(note);
      osc.detune.value = (index - notes.length / 2) * 2.4;
      shimmer.type = "sine";
      shimmer.frequency.value = midiToHz(note + 12);
      shimmerGain.gain.value = 0.08;
      osc.connect(bus);
      shimmer.connect(shimmerGain).connect(bus);
      osc.start(time + random(0, 0.018));
      shimmer.start(time + random(0, 0.02));
      osc.stop(time + duration + 0.08);
      shimmer.stop(time + duration + 0.08);
    });
  }

  private playBassLine(chord: Chord, nextChord: Chord, time: number, beat: number, density: number): void {
    this.playBass(chord.bass, time, beat * 1.45, 0.12 * density);
    if (this.section !== "break" && Math.random() < 0.28 + this.settings.energy * 0.35) {
      this.playBass(chord.bass + choose([0, 7, 12]), time + beat * 2, beat * 0.75, 0.065 * density);
    }
    if (Math.random() < 0.38 + this.settings.variation * 0.28) {
      const direction = Math.sign(nextChord.bass - chord.bass) || 1;
      this.playBass(nextChord.bass - direction, time + beat * 3.5, beat * 0.38, 0.045 * density);
    }
  }

  private playBass(note: number, time: number, duration: number, volume: number): void {
    if (!this.context || !this.musicBus) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.value = midiToHz(note);
    filter.type = "lowpass";
    filter.frequency.value = 150 + this.settings.energy * 70;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter).connect(gain).connect(this.musicBus);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private playMotif(chord: Chord, time: number, beat: number, density: number): void {
    const chance = (0.28 + this.settings.energy * 0.38) * density;
    const root = 60 + chord.degrees[0]!;
    const rhythm = choose([
      [0.5, 1.5, 2.5, 3.25],
      [0.75, 1.75, 2.75],
      [0.25, 1.25, 2.0, 3.5],
      [1.0, 2.5, 3.25],
    ]);
    rhythm.forEach((offset, index) => {
      if (Math.random() > chance) return;
      const motifNote = this.motif[index % this.motif.length]!;
      const chordTone = chord.degrees.reduce((best, degree) => Math.abs(degree - motifNote) < Math.abs(best - motifNote) ? degree : best, chord.degrees[0]!);
      const useColorTone = Math.random() < 0.42;
      const note = root + (useColorTone ? motifNote : chordTone) + 12;
      const swing = index % 2 ? beat * 0.055 : 0;
      this.playKey(note, time + offset * beat + swing + random(-0.012, 0.012), beat * choose([0.34, 0.5, 0.78]), 0.042 * density);
    });
  }

  private playKey(note: number, time: number, duration: number, volume: number): void {
    if (!this.context || !this.musicBus) return;
    const carrier = this.context.createOscillator();
    const overtone = this.context.createOscillator();
    const gain = this.context.createGain();
    const overtoneGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();
    carrier.type = "triangle";
    carrier.frequency.value = midiToHz(note);
    overtone.type = "sine";
    overtone.frequency.value = midiToHz(note) * 2.01;
    overtoneGain.gain.value = 0.13;
    filter.type = "lowpass";
    filter.frequency.value = 1300 + (1 - this.settings.warmth) * 2600;
    pan.pan.value = random(-0.3, 0.3);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    carrier.connect(gain);
    overtone.connect(overtoneGain).connect(gain);
    gain.connect(filter).connect(pan).connect(this.musicBus);
    if (this.delay) filter.connect(this.delay);
    carrier.start(time);
    overtone.start(time);
    carrier.stop(time + duration + 0.05);
    overtone.stop(time + duration + 0.05);
  }

  private playPercussion(time: number, beat: number, density: number): void {
    if (this.section === "intro" || this.section === "break") {
      if (Math.random() < 0.5) this.hitNoise(time + beat * 3, 0.035, 0.012 * density, 3200);
      return;
    }
    this.playKick(time, 0.11 * density);
    if (Math.random() < 0.48 + this.settings.energy * 0.35) this.playKick(time + beat * 2.5, 0.065 * density);
    [1, 3].forEach(step => this.hitNoise(time + step * beat + 0.022, 0.12, 0.03 * density, 1150));
    for (let eighth = 0; eighth < 8; eighth += 1) {
      if (Math.random() < (0.35 + this.settings.energy * 0.42) * density) {
        const swing = eighth % 2 ? beat * 0.055 : 0;
        this.hitNoise(time + eighth * beat / 2 + swing, 0.012, random(0.004, 0.009) * density, 5200);
      }
    }
  }

  private playKick(time: number, volume: number): void {
    if (!this.context || !this.musicBus) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(115, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.11);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain).connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.23);
  }

  private hitNoise(time: number, duration: number, volume: number, frequency: number): void {
    if (!this.context || !this.musicBus || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain).connect(this.musicBus);
    source.start(time, random(0, 2));
    source.stop(time + duration);
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const context = this.context!;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.985 + white * 0.015;
      data[index] = previous * 3.2;
    }
    return buffer;
  }

  private startTexture(): void {
    if (!this.context || !this.textureBus || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = "bandpass";
    filter.frequency.value = this.settings.preset === "rainy" ? 2600 : 1450;
    filter.Q.value = 0.35;
    source.connect(filter).connect(this.textureBus);
    source.start();
  }
}
