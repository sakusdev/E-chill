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

type Section = "intro" | "groove" | "bloom" | "break" | "return";
type Chord = {
  root: number;
  suffix: string;
  degrees: number[];
  bass: number;
  next: Array<[number, number]>;
};
type PhrasePlan = {
  contour: number[];
  responseContour: number[];
  rhythmA: number[];
  rhythmB: number[];
  activeBars: Set<number>;
};

type MelodyState = {
  previousNote: number | null;
  previousDirection: -1 | 0 | 1;
  phrasePeak: number;
};

const CHORDS: Chord[] = [
  { root: 0, suffix: "maj9", degrees: [0, 4, 7, 11, 14], bass: 36, next: [[1, 2], [2, 5], [3, 4], [5, 2], [6, 3], [9, 2]] },
  { root: 1, suffix: "dim7", degrees: [1, 4, 7, 10], bass: 37, next: [[2, 12]] },
  { root: 2, suffix: "m9", degrees: [2, 5, 9, 12, 16], bass: 38, next: [[3, 3], [5, 6], [6, 3], [7, 2], [9, 2]] },
  { root: 5, suffix: "maj9", degrees: [5, 9, 12, 16, 19], bass: 41, next: [[0, 5], [4, 6], [5, 2], [6, 2]] },
  { root: 5, suffix: "m6", degrees: [5, 8, 12, 14], bass: 41, next: [[0, 12], [8, 2]] },
  { root: 7, suffix: "13sus", degrees: [7, 12, 14, 17, 21], bass: 43, next: [[0, 9], [4, 2]] },
  { root: 9, suffix: "m9", degrees: [9, 12, 16, 19, 23], bass: 45, next: [[2, 4], [3, 3], [5, 3], [7, 2], [9, 2]] },
  { root: 7, suffix: "m9", degrees: [7, 10, 14, 17, 21], bass: 43, next: [[8, 10], [3, 2]] },
  { root: 0, suffix: "13", degrees: [0, 4, 10, 14, 21], bass: 36, next: [[3, 11], [4, 1]] },
  { root: 9, suffix: "11", degrees: [9, 14, 16, 19, 23], bass: 45, next: [[2, 5], [6, 4], [5, 2]] },
  { root: 4, suffix: "m9", degrees: [4, 7, 11, 14, 18], bass: 40, next: [[6, 5], [3, 3], [9, 2]] },
  { root: 11, suffix: "7alt", degrees: [11, 15, 18, 21, 26], bass: 47, next: [[10, 9], [6, 4]] },
];

const NOTE_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const SECTION_NAMES: Record<Section, string> = {
  intro: "INTRO",
  groove: "GROOVE",
  bloom: "BLOOM",
  break: "BREATH",
  return: "RETURN",
};

const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const random = (min: number, max: number): number => min + Math.random() * (max - min);
const choose = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const pitchClass = (note: number): number => ((note % 12) + 12) % 12;

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
  private delaySend: GainNode | null = null;
  private timer: number | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private chordIndex = 0;
  private nextChordIndex = 2;
  private nextTime = 0;
  private bar = 0;
  private section: Section = "intro";
  private sectionBars = 0;
  private keyShift = 0;
  private chapter = 0;
  private previousVoicing: number[] = [];
  private recentChords: number[] = [];
  private phrase: PhrasePlan = this.createPhrase();
  private melody: MelodyState = { previousNote: null, previousDirection: 0, phrasePeak: 76 };
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
    if (this.master && this.context) this.master.gain.setTargetAtTime(settings.volume * 0.38, this.context.currentTime, 0.08);
    if (this.textureBus && this.context) this.textureBus.gain.setTargetAtTime(settings.texture * 0.12, this.context.currentTime, 0.3);
  }

  async start(): Promise<void> {
    if (this.context) return;
    this.context = new AudioContext();
    await this.context.resume();
    this.master = this.context.createGain();
    this.musicBus = this.context.createGain();
    this.textureBus = this.context.createGain();
    this.delay = this.context.createDelay(2);
    this.delaySend = this.context.createGain();
    const feedback = this.context.createGain();
    const delayFilter = this.context.createBiquadFilter();
    const compressor = this.context.createDynamicsCompressor();
    const masterFilter = this.context.createBiquadFilter();
    this.master.gain.value = this.settings.volume * 0.38;
    this.musicBus.gain.value = 1;
    this.textureBus.gain.value = this.settings.texture * 0.12;
    this.delay.delayTime.value = 0.38;
    this.delaySend.gain.value = 0.24;
    feedback.gain.value = 0.24;
    delayFilter.type = "lowpass";
    delayFilter.frequency.value = 2400;
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = 14500;
    compressor.threshold.value = -20;
    compressor.knee.value = 22;
    compressor.ratio.value = 2.6;
    compressor.attack.value = 0.025;
    compressor.release.value = 0.42;
    this.delaySend.connect(this.delay);
    this.delay.connect(delayFilter).connect(feedback).connect(this.delay);
    delayFilter.connect(this.musicBus);
    this.musicBus.connect(masterFilter);
    this.textureBus.connect(masterFilter);
    masterFilter.connect(compressor).connect(this.master).connect(this.context.destination);
    this.noiseBuffer = this.makeNoiseBuffer(6);
    this.startTexture();
    this.nextTime = this.context.currentTime + 0.1;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.textureBus = null;
    this.delay = null;
    this.delaySend = null;
    this.noiseBuffer = null;
  }

  regenerate(): void {
    this.phrase = this.createPhrase();
    this.melody = { previousNote: null, previousDirection: 0, phrasePeak: 76 + this.keyShift };
    this.nextChordIndex = weightedChoice(CHORDS[this.chordIndex]!.next);
    this.section = "bloom";
    this.sectionBars = 0;
    if (Math.random() < 0.45) this.keyShift = choose([0, 2, 5, -3]);
  }

  private schedule(): void {
    if (!this.context) return;
    const presetOffset = this.settings.preset === "sunset" ? 4 : this.settings.preset === "rainy" ? -3 : 0;
    const breathing = Math.sin(this.bar / 12) * 1.4;
    const bpm = Math.round(65 + this.settings.energy * 19 + presetOffset + breathing);
    const beat = 60 / bpm;
    while (this.nextTime < this.context.currentTime + 1.8) {
      this.scheduleBar(this.nextTime, beat);
      this.nextTime += beat * 4;
    }
  }

  private scheduleBar(time: number, beat: number): void {
    const chord = CHORDS[this.chordIndex]!;
    const nextChord = CHORDS[this.nextChordIndex]!;
    const phraseBar = this.bar % 8;
    const density = this.sectionDensity() * this.dynamicArc(phraseBar);
    this.onSnapshot({
      chord: this.chordName(chord),
      nextChord: this.chordName(nextChord),
      key: `${NOTE_NAMES[(12 + this.keyShift) % 12]} major / ${NOTE_NAMES[(21 + this.keyShift) % 12]} minor`,
      bpm: Math.round(60 / beat),
      section: SECTION_NAMES[this.section],
      bar: this.bar + 1,
    });
    const voicing = this.chooseVoicing(chord);
    const isBreath = this.section === "break" || !this.phrase.activeBars.has(phraseBar);
    this.playPad(voicing, time, beat * 3.94, density * (isBreath ? 0.72 : 1));
    if (!isBreath || Math.random() < 0.35) this.playBassLine(chord, nextChord, time, beat, density);
    if (!isBreath) {
      this.playPhrase(chord, nextChord, time, beat, density, phraseBar);
      this.playComping(voicing, time, beat, density, phraseBar);
    }
    this.playPercussion(time, beat, density, phraseBar, isBreath);
    this.previousVoicing = voicing;
    this.bar += 1;
    this.sectionBars += 1;
    if (this.bar % 8 === 0) {
      this.phrase = this.evolvePhrase(this.phrase);
      this.melody.previousDirection = 0;
    }
    if (this.bar % 32 === 0) this.advanceChapter();
    this.advanceForm();
    this.advanceHarmony();
  }

  private dynamicArc(phraseBar: number): number {
    const arc = [0.72, 0.82, 0.9, 0.78, 0.88, 0.98, 1.08, 0.68];
    return arc[phraseBar]! * (0.82 + this.settings.energy * 0.28);
  }

  private sectionDensity(): number {
    const values: Record<Section, number> = { intro: 0.54, groove: 0.92, bloom: 1.12, break: 0.38, return: 0.84 };
    return values[this.section];
  }

  private advanceHarmony(): void {
    this.chordIndex = this.nextChordIndex;
    const chord = CHORDS[this.chordIndex]!;
    let candidates = chord.next.map(([index, weight]) => [index, weight] as [number, number]);
    candidates = candidates.map(([index, weight]) => {
      const repeatPenalty = this.recentChords.slice(-4).includes(index) ? 0.42 : 1;
      const cadenceBonus = this.bar % 8 === 7 && index === 0 ? 2.8 : 1;
      return [index, weight * repeatPenalty * cadenceBonus] as [number, number];
    });
    if (Math.random() < this.settings.variation * 0.08) candidates.push([Math.floor(Math.random() * CHORDS.length), 0.65]);
    this.nextChordIndex = weightedChoice(candidates);
    this.recentChords.push(this.chordIndex);
    this.recentChords = this.recentChords.slice(-16);
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
  }

  private advanceChapter(): void {
    this.chapter += 1;
    const shifts = this.settings.preset === "rainy" ? [0, -3, 5] : [0, 2, 5, -3];
    if (Math.random() < 0.5 + this.settings.variation * 0.3) {
      const options = shifts.filter(shift => shift !== this.keyShift);
      this.keyShift = choose(options);
      this.previousVoicing = [];
      this.melody.previousNote = null;
    }
    this.section = this.chapter % 3 === 0 ? "break" : "intro";
    this.sectionBars = 0;
  }

  private createPhrase(): PhrasePlan {
    const contours = [[0, 2, 4, 2], [0, 2, 1, 4], [4, 2, 0, 1], [0, 4, 2, 5], [2, 4, 5, 4]];
    const contour = [...choose(contours)];
    const responseContour = contour.map((degree, index) => index === contour.length - 1 ? 0 : clamp(degree + choose([-1, 0, 1]), 0, 6));
    return {
      contour,
      responseContour,
      rhythmA: choose([[0.5, 1.5, 2.75], [0.75, 1.75, 3], [0.5, 2, 3.25], [1, 2.25, 3.25]]),
      rhythmB: choose([[0.75, 1.75, 2.75], [0.5, 1.5, 3.25], [1, 2.5, 3.25]]),
      activeBars: new Set(choose([[0, 1, 2, 4, 5, 6], [0, 2, 3, 4, 6], [1, 2, 4, 5, 7]])),
    };
  }

  private evolvePhrase(phrase: PhrasePlan): PhrasePlan {
    const contour = [...phrase.contour];
    const index = Math.floor(Math.random() * contour.length);
    contour[index] = clamp(contour[index]! + choose([-1, 1]), 0, 6);
    return {
      contour,
      responseContour: contour.map((degree, i) => i === contour.length - 1 ? 0 : clamp(degree + choose([-1, 0, 1]), 0, 6)),
      rhythmA: Math.random() < 0.76 ? phrase.rhythmA : this.createPhrase().rhythmA,
      rhythmB: Math.random() < 0.76 ? phrase.rhythmB : this.createPhrase().rhythmB,
      activeBars: Math.random() < 0.8 ? phrase.activeBars : this.createPhrase().activeBars,
    };
  }

  private chordName(chord: Chord): string {
    return `${NOTE_NAMES[(chord.root + this.keyShift + 12) % 12]}${chord.suffix}`;
  }

  private chooseVoicing(chord: Chord): number[] {
    const candidates: number[][] = [];
    const shifted = chord.degrees.map(degree => degree + this.keyShift);
    for (let inversion = 0; inversion < shifted.length; inversion += 1) {
      const notes = shifted.map((degree, index) => 55 + degree + (index < inversion ? 12 : 0));
      for (const octave of [-12, 0, 12]) {
        const candidate = notes.map(note => note + octave).filter(note => note >= 48 && note <= 82);
        if (candidate.length >= 4) candidates.push(candidate);
      }
    }
    if (!this.previousVoicing.length) return candidates[0]!;
    const cost = (candidate: number[]): number => candidate.reduce((sum, note) => sum + Math.min(...this.previousVoicing.map(previous => Math.abs(previous - note))), 0) + Math.abs(candidate.length - this.previousVoicing.length) * 3;
    return candidates.reduce((best, candidate) => cost(candidate) < cost(best) ? candidate : best, candidates[0]!);
  }

  private playPad(notes: number[], time: number, duration: number, density: number): void {
    if (!this.context || !this.musicBus) return;
    const bus = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();
    filter.type = "lowpass";
    filter.frequency.value = 560 + (1 - this.settings.warmth) * 2500 + this.settings.energy * 420;
    filter.Q.value = 0.3;
    pan.pan.value = random(-0.16, 0.16);
    bus.gain.setValueAtTime(0.0001, time);
    bus.gain.exponentialRampToValueAtTime(0.046 * density, time + 0.42);
    bus.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    bus.connect(filter).connect(pan).connect(this.musicBus);
    if (this.delaySend) filter.connect(this.delaySend);
    notes.forEach((note, index) => {
      const osc = this.context!.createOscillator();
      const air = this.context!.createOscillator();
      const airGain = this.context!.createGain();
      osc.type = index % 2 ? "triangle" : "sine";
      osc.frequency.value = midiToHz(note);
      osc.detune.value = (index - notes.length / 2) * 2.1;
      air.type = "sine";
      air.frequency.value = midiToHz(note + 12);
      airGain.gain.value = 0.055;
      osc.connect(bus);
      air.connect(airGain).connect(bus);
      osc.start(time + random(0, 0.025));
      air.start(time + random(0, 0.028));
      osc.stop(time + duration + 0.1);
      air.stop(time + duration + 0.1);
    });
  }

  private playComping(notes: number[], time: number, beat: number, density: number, phraseBar: number): void {
    if (this.section === "intro" || this.section === "break") return;
    const patterns = [[1.5, 3.25], [0.75, 2.75], [1, 2.5, 3.5]];
    const pattern = patterns[phraseBar % patterns.length]!;
    pattern.forEach((offset, index) => {
      if (Math.random() > 0.35 + this.settings.energy * 0.35) return;
      const selected = notes.filter((_, noteIndex) => noteIndex !== 0 || index % 2 === 0);
      selected.forEach((note, noteIndex) => this.playKey(note + (noteIndex > 2 ? 0 : 12), time + offset * beat, beat * 0.2, 0.008 * density));
    });
  }

  private playBassLine(chord: Chord, nextChord: Chord, time: number, beat: number, density: number): void {
    const root = chord.bass + this.keyShift;
    const nextRoot = nextChord.bass + this.keyShift;
    this.playBass(root, time, beat * 1.35, 0.1 * density);
    if (this.section !== "break" && Math.random() < 0.3 + this.settings.energy * 0.34) this.playBass(root + choose([0, 7, 12]), time + beat * 2, beat * 0.7, 0.052 * density);
    if (Math.random() < 0.42 + this.settings.variation * 0.25) {
      const direction = Math.sign(nextRoot - root) || 1;
      this.playBass(nextRoot - direction, time + beat * 3.5, beat * 0.34, 0.038 * density);
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
    filter.frequency.value = 145 + this.settings.energy * 75;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter).connect(gain).connect(this.musicBus);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private playPhrase(chord: Chord, nextChord: Chord, time: number, beat: number, density: number, phraseBar: number): void {
    const isResponse = phraseBar >= 4;
    const contour = isResponse ? this.phrase.responseContour : this.phrase.contour;
    const rhythm = isResponse ? this.phrase.rhythmB : this.phrase.rhythmA;
    const cadenceBar = phraseBar === 3 || phraseBar === 7;
    const noteCount = cadenceBar ? Math.min(2, rhythm.length) : rhythm.length;
    const barNotes: number[] = [];
    for (let index = 0; index < noteCount; index += 1) {
      if (index > 0 && Math.random() > 0.78 + this.settings.energy * 0.12) continue;
      const scaleDegree = contour[index % contour.length]!;
      const targetPitchClass = (SCALE[scaleDegree]! + this.keyShift + 12) % 12;
      const note = this.selectMelodyNote(chord, nextChord, targetPitchClass, index, noteCount, cadenceBar);
      barNotes.push(note);
      const offset = rhythm[index]!;
      const duration = this.melodyDuration(index, noteCount, beat, cadenceBar);
      const swing = index % 2 ? beat * 0.035 : 0;
      const accent = index === 0 ? 1 : 0.88;
      this.playKey(note, time + offset * beat + swing + random(-0.008, 0.008), duration, 0.031 * density * accent);
    }
    if (barNotes.length > 0) {
      const last = barNotes.at(-1)!;
      const previous = this.melody.previousNote;
      this.melody.previousDirection = previous === null ? 0 : Math.sign(last - previous) as -1 | 0 | 1;
      this.melody.previousNote = last;
    }
  }

  private selectMelodyNote(chord: Chord, nextChord: Chord, targetPitchClass: number, index: number, noteCount: number, cadenceBar: boolean): number {
    const previous = this.melody.previousNote;
    const chordPitchClasses = chord.degrees.map(degree => pitchClass(degree + this.keyShift));
    const nextPitchClasses = nextChord.degrees.map(degree => pitchClass(degree + this.keyShift));
    const candidates: number[] = [];
    for (let note = 62 + this.keyShift; note <= 79 + this.keyShift; note += 1) {
      const pc = pitchClass(note);
      const inScale = SCALE.some(scaleNote => pitchClass(scaleNote + this.keyShift) === pc);
      const chordTone = chordPitchClasses.includes(pc);
      if (inScale || chordTone) candidates.push(note);
    }
    const isLast = index === noteCount - 1;
    const score = (note: number): number => {
      const pc = pitchClass(note);
      const interval = previous === null ? 0 : Math.abs(note - previous);
      let value = 0;
      value += pc === targetPitchClass ? 4.5 : 0;
      value += chordPitchClasses.includes(pc) ? (isLast ? 5 : 2.4) : 0;
      value += isLast && cadenceBar && nextPitchClasses.includes(pc) ? 3.5 : 0;
      value += interval <= 2 ? 4 : interval <= 4 ? 2.2 : interval <= 7 ? 0.4 : -5;
      value += interval === 0 ? -1.2 : 0;
      value += note >= 65 + this.keyShift && note <= 76 + this.keyShift ? 1.2 : -0.6;
      value += note > this.melody.phrasePeak ? -2.5 : 0;
      if (previous !== null && this.melody.previousDirection !== 0) {
        const direction = Math.sign(note - previous);
        value += direction === this.melody.previousDirection && interval > 2 ? -1.5 : 0.5;
      }
      if (isLast && cadenceBar) value += [0, 4, 7].includes(pitchClass(note - this.keyShift)) ? 2.5 : -0.8;
      return value;
    };
    const ranked = candidates.map(note => [note, score(note)] as const).sort((a, b) => b[1] - a[1]);
    const pool = ranked.slice(0, Math.max(2, Math.round(2 + this.settings.variation * 3)));
    const weights = pool.map(([note, value]) => [note, Math.exp(value / (1.3 + this.settings.variation))] as [number, number]);
    return weightedChoice(weights);
  }

  private melodyDuration(index: number, noteCount: number, beat: number, cadenceBar: boolean): number {
    if (index === noteCount - 1 && cadenceBar) return beat * 1.15;
    return beat * choose([0.42, 0.58, 0.72]);
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
    overtone.frequency.value = midiToHz(note) * 2.005;
    overtoneGain.gain.value = 0.095;
    filter.type = "lowpass";
    filter.frequency.value = 1080 + (1 - this.settings.warmth) * 2800;
    pan.pan.value = random(-0.22, 0.22);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    carrier.connect(gain);
    overtone.connect(overtoneGain).connect(gain);
    gain.connect(filter).connect(pan).connect(this.musicBus);
    if (this.delaySend) filter.connect(this.delaySend);
    carrier.start(time);
    overtone.start(time);
    carrier.stop(time + duration + 0.06);
    overtone.stop(time + duration + 0.06);
  }

  private playPercussion(time: number, beat: number, density: number, phraseBar: number, isBreath: boolean): void {
    if (isBreath || this.section === "intro") {
      if (Math.random() < 0.4) this.hitNoise(time + beat * 3, 0.04, 0.009 * density, 3400);
      return;
    }
    this.playKick(time, 0.09 * density);
    if (phraseBar % 2 === 1 && Math.random() < 0.45 + this.settings.energy * 0.3) this.playKick(time + beat * 2.5, 0.05 * density);
    [1, 3].forEach(step => this.hitNoise(time + step * beat + 0.024, 0.12, 0.024 * density, 1100));
    for (let eighth = 0; eighth < 8; eighth += 1) {
      if (Math.random() < (0.3 + this.settings.energy * 0.38) * density) {
        const swing = eighth % 2 ? beat * 0.052 : 0;
        this.hitNoise(time + eighth * beat / 2 + swing, 0.012, random(0.003, 0.007) * density, 5100);
      }
    }
    if (phraseBar === 7 && Math.random() < 0.55) [3.25, 3.5, 3.75].forEach((offset, index) => this.hitNoise(time + offset * beat, 0.02, (0.006 + index * 0.002) * density, 2600 + index * 700));
  }

  private playKick(time: number, volume: number): void {
    if (!this.context || !this.musicBus) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(105, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.12);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    osc.connect(gain).connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  private hitNoise(time: number, duration: number, volume: number, frequency: number): void {
    if (!this.context || !this.musicBus || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.75;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain).connect(this.musicBus);
    source.start(time, random(0, 3));
    source.stop(time + duration);
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const context = this.context!;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.986 + white * 0.014;
      data[index] = previous * 3.1;
    }
    return buffer;
  }

  private startTexture(): void {
    if (!this.context || !this.textureBus || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const modulation = this.context.createOscillator();
    const modulationGain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = "bandpass";
    filter.frequency.value = this.settings.preset === "rainy" ? 2800 : 1350;
    filter.Q.value = 0.32;
    modulation.frequency.value = 0.08;
    modulationGain.gain.value = 220;
    modulation.connect(modulationGain).connect(filter.frequency);
    source.connect(filter).connect(this.textureBus);
    source.start();
    modulation.start();
  }
}
