import createIcon from './vendor/lucide/createElement.js';
import Volume2 from './vendor/lucide/icons/volume-2.js';
import VolumeX from './vendor/lucide/icons/volume-x.js';

let context;
let muted = localStorage.getItem('pokerSoundMuted') === 'true';
const button = document.querySelector('#soundButton');

function updateButton() {
  button.setAttribute('aria-pressed', String(!muted));
  button.replaceChildren(createIcon(muted ? VolumeX : Volume2, { width: 16, height: 16, 'aria-hidden': 'true' }));
  button.title = muted ? '开启下注音效' : '关闭下注音效';
  button.setAttribute('aria-label', button.title);
}
updateButton();
button.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('pokerSoundMuted', String(muted));
  updateButton();
});

function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  context ||= new AudioContext();
  if (context.state === 'suspended') context.resume().catch(() => {});
}
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);

export function playWagerSound(amount) {
  if (muted || context?.state !== 'running') return;
  const count = Math.min(6, 2 + Math.floor(amount / 100));
  for (let i = 0; i < count; i++) {
    const start = context.currentTime + i * 0.055;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(1700 + i * 157, start);
    oscillator.frequency.exponentialRampToValueAtTime(650, start + 0.045);
    filter.type = 'highpass'; filter.frequency.value = 850;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.075, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.065);
    oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
    oscillator.start(start); oscillator.stop(start + 0.07);
    oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
}
