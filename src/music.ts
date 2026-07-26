export type EngineSnapshot = { chord: string; key: string; bpm: number };
type Settings = { energy: number; warmth: number; variation: number };
type Chord = { name: string; notes: number[]; bass: number; next: number[] };

const CHORDS: Chord[] = [
  { name: "Cmaj7", notes: [60, 64, 67, 71], bass: 36, next: [1, 2, 3, 4] },
  { name: "C♯dim7", notes: [61, 64, 67, 70], bass: 37, next: [2] },
  { name: "Dm7", notes: [62, 65, 69, 72], bass: 38, next: [3, 5, 6] },
  { name: "Fmaj7", notes: [60, 64, 65, 69], bass: 41, next: [0, 4, 5] },
  { name: "Fm6", notes: [60, 62, 65, 68], bass: 41, next: [0, 6] },
  { name: "G13sus", notes: [60, 65, 67, 69, 76], bass: 43, next: [0, 4] },
  { name: "Am9", notes: [59, 60, 64, 67, 69], bass: 45, next: [2, 3, 5] },
];

const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);
const choose = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;

export class ChillEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private delay: DelayNode | null = null;
  private feedback: GainNode | null = null;
  private timer: number | null = null;
  private chordIndex = 0;
  private nextTime = 0;
  private settings: Settings = { energy: .32, warmth: .76, variation: .38 };

  constructor(private readonly onSnapshot: (snapshot: EngineSnapshot) => void) {}
  setSettings(settings: Settings): void { this.settings = settings; }

  async start(): Promise<void> {
    if (this.context) return;
    this.context = new AudioContext();
    await this.context.resume();
    this.master = this.context.createGain();
    this.master.gain.value = .3;
    this.master.connect(this.context.destination);
    this.delay = this.context.createDelay(1.5);
    this.delay.delayTime.value = .34;
    this.feedback = this.context.createGain();
    this.feedback.gain.value = .22;
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.master);
    this.nextTime = this.context.currentTime + .08;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 120);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private schedule(): void {
    if (!this.context) return;
    const bpm = Math.round(68 + this.settings.energy * 22);
    const beat = 60 / bpm;
    while (this.nextTime < this.context.currentTime + 1.2) {
      this.scheduleBar(this.nextTime, beat);
      this.nextTime += beat * 4;
    }
  }

  private scheduleBar(time: number, beat: number): void {
    const chord = CHORDS[this.chordIndex]!;
    this.onSnapshot({ chord: chord.name, key: "C major", bpm: Math.round(60 / beat) });
    this.playPad(chord.notes, time, beat * 3.85);
    this.playBass(chord.bass, time, beat * 1.4);
    const melodyChance = .28 + this.settings.energy * .34;
    chord.notes.forEach((note, index) => {
      if (Math.random() < melodyChance) {
        const offset = choose([.5, 1, 1.5, 2, 2.5, 3]) * beat;
        this.playBell(note + (index % 2 ? 12 : 0), time + offset, beat * choose([.45, .75, 1.1]));
      }
    });
    this.playPercussion(time, beat);
    const stayChance = .12 + (1 - this.settings.variation) * .25;
    if (Math.random() > stayChance) this.chordIndex = choose(chord.next);
  }

  private playPad(notes: number[], time: number, duration: number): void {
    if (!this.context || !this.master) return;
    const bus = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 750 + (1 - this.settings.warmth) * 1800;
    bus.gain.setValueAtTime(0, time);
    bus.gain.linearRampToValueAtTime(.065, time + .35);
    bus.gain.exponentialRampToValueAtTime(.001, time + duration);
    bus.connect(filter).connect(this.master);
    if (this.delay) filter.connect(this.delay);
    notes.forEach((note, i) => {
      const osc = this.context!.createOscillator();
      osc.type = i % 2 ? "triangle" : "sine";
      osc.frequency.value = midiToHz(note);
      osc.detune.value = (i - notes.length / 2) * 3;
      osc.connect(bus);
      osc.start(time);
      osc.stop(time + duration + .05);
    });
  }

  private playBass(note: number, time: number, duration: number): void {
    if (!this.context || !this.master) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.value = midiToHz(note);
    filter.type = "lowpass";
    filter.frequency.value = 180;
    gain.gain.setValueAtTime(.13, time);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + duration);
  }

  private playBell(note: number, time: number, duration: number): void {
    if (!this.context || !this.master) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "sine";
    osc.frequency.value = midiToHz(note);
    gain.gain.setValueAtTime(.045, time);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    osc.connect(gain).connect(this.master);
    if (this.delay) gain.connect(this.delay);
    osc.start(time);
    osc.stop(time + duration);
  }

  private playPercussion(time: number, beat: number): void {
    [0, 2].forEach(step => this.hitNoise(time + step * beat, .018, .025));
    [1, 3].forEach(step => this.hitNoise(time + step * beat + .018, .11, .035));
    for (let eighth = 0; eighth < 8; eighth += 1) {
      if (Math.random() < .42 + this.settings.energy * .28) this.hitNoise(time + eighth * beat / 2, .008, .008);
    }
  }

  private hitNoise(time: number, duration: number, volume: number): void {
    if (!this.context || !this.master) return;
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = duration > .05 ? 900 : 4200;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(time);
  }
}
