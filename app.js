// 1. State Management
let alarms = JSON.parse(localStorage.getItem('voice_alarms_list')) || [];
let isVoiceUnlocked = false;
let wakeLockRef = null;
let activeRingingAlarm = null;
let speechLoopTimeout = null;
let lastTriggeredMinuteKey = '';
let lastShakeTime = 0;

function saveAlarms() {
  localStorage.setItem('voice_alarms_list', JSON.stringify(alarms));
}

// 2. Time Formatting Helpers
function parse24HourTime(timeStr) {
  const [rawHours, rawMinutes] = timeStr.split(':').map(Number);
  const ampm = rawHours >= 12 ? 'PM' : 'AM';
  const hour12 = rawHours % 12 || 12;
  const paddedMinutes = String(rawMinutes).padStart(2, '0');
  return {
    formatted: `${hour12}:${paddedMinutes} ${ampm}`,
    hour12,
    minute: rawMinutes,
    ampm
  };
}

// Speaks ONLY the time (e.g., "7:35 AM")
function buildSpokenTimePhrase(timeStr) {
  const { formatted } = parse24HourTime(timeStr);
  return formatted;
}

// 3. Speech Synthesis (Text-to-Speech) Engine
function speakText(text, rate = 1.2, onComplete = null) {
  if (!('speechSynthesis' in window)) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = parseFloat(rate) || 1.2;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(
    v => v.lang.startsWith('en') && (v.name.includes('Samantha') || v.name.includes('Siri') || v.default)
  );
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  if (typeof onComplete === 'function') {
    utterance.onend = () => onComplete();
    utterance.onerror = () => onComplete();
  }

  window.speechSynthesis.speak(utterance);
}

// Loop helper: speaks the time, waits 2 seconds after finishing, then repeats
function startAlarmSpeechLoop(spokenPhrase, rate) {
  if (!activeRingingAlarm) return;

  speakText(spokenPhrase, rate, () => {
    if (!activeRingingAlarm) return;
    clearTimeout(speechLoopTimeout);
    speechLoopTimeout = setTimeout(() => {
      if (activeRingingAlarm) {
        startAlarmSpeechLoop(spokenPhrase, rate);
      }
    }, 2000);
  });
}

// 4. Hardware Volume Buttons, Media Buttons & Shake-to-Snooze Listeners
function handleHardwareVolumeOrKeySnooze(e) {
  if (!activeRingingAlarm) return;

  const volumeKeys = [
    'AudioVolumeUp',
    'AudioVolumeDown',
    'AudioVolumeMute',
    'VolumeUp',
    'VolumeDown',
    'VolumeMute'
  ];
  const volumeKeyCodes = [24, 25, 173, 174, 175]; // Android & Standard Hardware Volume KeyCodes

  if (
    volumeKeys.includes(e.key) ||
    volumeKeys.includes(e.code) ||
    volumeKeyCodes.includes(e.keyCode) ||
    volumeKeyCodes.includes(e.which)
  ) {
    e.preventDefault();
    snoozeCurrentAlarm();
  }
}

window.addEventListener('keydown', handleHardwareVolumeOrKeySnooze, { passive: false });
window.addEventListener('keyup', handleHardwareVolumeOrKeySnooze, { passive: false });

// Physical Shake / Nudge Sensor (Works on iPhone & Android when alarm is ringing)
function handleDeviceMotionSnooze(event) {
  if (!activeRingingAlarm) return;

  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  const totalAcceleration = Math.sqrt(
    (acc.x || 0) * (acc.x || 0) +
    (acc.y || 0) * (acc.y || 0) +
    (acc.z || 0) * (acc.z || 0)
  );

  // Normal gravity is ~9.8 m/s^2. A light shake or nudge exceeds 16.5 m/s^2
  const now = Date.now();
  if (totalAcceleration > 16.5 && now - lastShakeTime > 1500) {
    lastShakeTime = now;
    snoozeCurrentAlarm();
  }
}

window.addEventListener('devicemotion', handleDeviceMotionSnooze);

// Setup MediaSession API so headset/lockscreen controls also trigger Snooze
function registerMediaSessionSnooze() {
  if ('mediaSession' in navigator) {
    const actions = ['pause', 'stop', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward'];
    actions.forEach(action => {
      try {
        navigator.mediaSession.setActionHandler(action, () => {
          if (activeRingingAlarm) {
            snoozeCurrentAlarm();
          }
        });
      } catch (e) {}
    });
  }
}

// 5. Unlock iOS Voice Engine, Motion Sensor Permission & Screen Wake Lock
async function unlockVoiceAndWakeLock(silent = false) {
  isVoiceUnlocked = true;

  // Request iOS 13+ Motion Sensor Permission for Shake-to-Snooze
  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function'
  ) {
    try {
      await DeviceMotionEvent.requestPermission();
    } catch (err) {
      console.log('Motion permission note:', err.message);
    }
  }

  registerMediaSessionSnooze();

  const dot = document.getElementById('voiceStatusDot');
  const statusText = document.getElementById('voiceStatusText');
  const btn = document.getElementById('activateVoiceBtn');

  dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
  statusText.textContent = 'Voice, Shake-Snooze & WakeLock Armed';
  btn.textContent = '✅ Armed';
  btn.className = 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs px-3.5 py-1.5 rounded-xl shrink-0';

  if (!silent) {
    const timeVal = document.getElementById('alarmTimeInput').value || '07:35';
    speakText(buildSpokenTimePhrase(timeVal), 1.2);
  }

  if ('wakeLock' in navigator) {
    try {
      wakeLockRef = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.log('WakeLock note:', err.message);
    }
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && isVoiceUnlocked && 'wakeLock' in navigator) {
    try {
      wakeLockRef = await navigator.wakeLock.request('screen');
    } catch (e) {}
  }
});

// 6. Test / Preview Voice Button
function previewSelectedTimeVoice() {
  unlockVoiceAndWakeLock(true);
  const timeVal = document.getElementById('alarmTimeInput').value || '07:35';
  const rateVal = document.getElementById('alarmRateInput').value || '1.2';

  const phrase = buildSpokenTimePhrase(timeVal);
  speakText(phrase, rateVal);
}

// 7. Live Clock & Every-Second Alarm Checker
function updateLiveClockAndCheckAlarms() {
  const now = new Date();

  const hours24 = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;

  const displayHours = String(hours12).padStart(2, '0');
  const displayMinutes = String(minutes).padStart(2, '0');
  const displaySeconds = String(seconds).padStart(2, '0');

  document.getElementById('liveClockTime').textContent = `${displayHours}:${displayMinutes}:${displaySeconds}`;
  document.getElementById('liveClockAmPm').textContent = ampm;

  document.getElementById('bedsideClockTime').textContent = `${hours12}:${displayMinutes}`;
  document.getElementById('bedsideClockAmPm').textContent = ampm;

  document.getElementById('currentDateText').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const currentHHMM = `${String(hours24).padStart(2, '0')}:${displayMinutes}`;
  const currentMinuteKey = `${now.toDateString()}_${currentHHMM}`;

  if (activeRingingAlarm || lastTriggeredMinuteKey === currentMinuteKey) {
    return;
  }

  const dayOfWeek = now.getDay();

  const matchingAlarm = alarms.find(alarm => {
    if (!alarm.enabled) return false;
    if (alarm.time !== currentHHMM) return false;

    if (alarm.repeat === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) return false;
    if (alarm.repeat === 'weekends' && dayOfWeek !== 0 && dayOfWeek !== 6) return false;

    return true;
  });

  if (matchingAlarm) {
    lastTriggeredMinuteKey = currentMinuteKey;
    triggerVoiceAlarm(matchingAlarm);
  }
}

// 8. Trigger, 2-Second Loop, 5-Min Snooze, and Stop Alarm
function triggerVoiceAlarm(alarm) {
  activeRingingAlarm = alarm;
  lastShakeTime = Date.now(); // Prevent accidental instant shake right on trigger

  if (alarm.repeat === 'once') {
    alarm.enabled = false;
    saveAlarms();
    renderAlarms();
  }

  const { formatted } = parse24HourTime(alarm.time);
  const spokenPhrase = buildSpokenTimePhrase(alarm.time);
  const speechRate = parseFloat(alarm.rate) || 1.2;

  document.getElementById('ringingTimeDisplay').textContent = formatted;
  document.getElementById('ringingLabelDisplay').textContent = alarm.label ? alarm.label : `"${spokenPhrase}"`;

  const modal = document.getElementById('ringingModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  clearTimeout(speechLoopTimeout);
  startAlarmSpeechLoop(spokenPhrase, speechRate);
}

function stopCurrentAlarm() {
  activeRingingAlarm = null;
  clearTimeout(speechLoopTimeout);
  window.speechSynthesis.cancel();

  const modal = document.getElementById('ringingModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function snoozeCurrentAlarm() {
  if (!activeRingingAlarm) return;

  const alarmToSnooze = activeRingingAlarm;
  stopCurrentAlarm();

  const snoozeDate = new Date(Date.now() + 5 * 60 * 1000);
  const snoozeHH = String(snoozeDate.getHours()).padStart(2, '0');
  const snoozeMM = String(snoozeDate.getMinutes()).padStart(2, '0');

  const snoozeAlarm = {
    id: 'alm_' + Date.now(),
    time: `${snoozeHH}:${snoozeMM}`,
    label: alarmToSnooze && alarmToSnooze.label ? `${alarmToSnooze.label} (Snooze)` : 'Snooze (5m)',
    repeat: 'once',
    rate: alarmToSnooze ? alarmToSnooze.rate : '1.2',
    enabled: true
  };

  alarms.unshift(snoozeAlarm);
  saveAlarms();
  renderAlarms();

  // Audible confirmation so you know it snoozed without looking at the screen
  speakText('Snoozed, 5 minutes', 1.2);
}

// 9. Add, Toggle, and Delete Alarms
document.getElementById('alarmForm').addEventListener('submit', function (e) {
  e.preventDefault();
  unlockVoiceAndWakeLock(true);

  const time = document.getElementById('alarmTimeInput').value;
  const label = document.getElementById('alarmLabelInput').value.trim();
  const repeat = document.getElementById('alarmRepeatInput').value;
  const rate = document.getElementById('alarmRateInput').value || '1.2';

  const newAlarm = {
    id: 'alm_' + Date.now(),
    time,
    label,
    repeat,
    rate,
    enabled: true
  };

  alarms.push(newAlarm);
  alarms.sort((a, b) => a.time.localeCompare(b.time));

  saveAlarms();
  document.getElementById('alarmLabelInput').value = '';
  renderAlarms();

  speakText(buildSpokenTimePhrase(time), rate);
});

function toggleAlarmState(id) {
  unlockVoiceAndWakeLock(true);
  const target = alarms.find(a => a.id === id);
  if (!target) return;
  target.enabled = !target.enabled;
  saveAlarms();
  renderAlarms();
}

function deleteAlarm(id) {
  alarms = alarms.filter(a => a.id !== id);
  saveAlarms();
  renderAlarms();
}

// 10. Bedside Nightstand Mode Toggle
function toggleBedsideMode(show) {
  const overlay = document.getElementById('bedsideOverlay');
  if (show) {
    unlockVoiceAndWakeLock(true);
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
  } else {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }
}

// 11. Render Alarms List
function renderAlarms() {
  const container = document.getElementById('alarmsContainer');
  const countText = document.getElementById('alarmCountText');
  container.innerHTML = '';

  const activeCount = alarms.filter(a => a.enabled).length;
  countText.textContent = `${activeCount} active`;

  if (alarms.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 px-4 bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl">
        <p class="text-slate-300 text-sm font-medium">No voice alarms set yet.</p>
        <p class="text-xs text-slate-500 mt-1">Pick a time above (e.g., 7:35 AM) and tap "+ Save Voice Alarm".</p>
      </div>
    `;
    return;
  }

  const repeatLabels = {
    daily: 'Every Day',
    once: 'Once Only',
    weekdays: 'Weekdays',
    weekends: 'Weekends'
  };

  alarms.forEach(alarm => {
    const { formatted } = parse24HourTime(alarm.time);
    const card = document.createElement('div');
    card.className = `rounded-2xl p-4 border transition flex justify-between items-center ${
      alarm.enabled
        ? 'bg-slate-900 border-slate-800 shadow-md'
        : 'bg-slate-900/40 border-slate-800/50 opacity-60'
    }`;

    card.innerHTML = `
      <div class="space-y-1">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl font-extrabold text-white tracking-tight">${formatted}</span>
          <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-400 border border-sky-500/30">
            ${repeatLabels[alarm.repeat] || 'Daily'}
          </span>
        </div>
        <p class="text-xs text-slate-400">
          ${alarm.label ? `📝 ${alarm.label}` : `🗣️ Speaks "${formatted}" every 2s`}
        </p>
      </div>

      <div class="flex items-center gap-3">
        <button onclick="toggleAlarmState('${alarm.id}')" 
          class="w-12 h-7 rounded-full p-1 transition duration-200 flex items-center ${
            alarm.enabled ? 'bg-sky-500 justify-end' : 'bg-slate-700 justify-start'
          }">
          <span class="w-5 h-5 rounded-full bg-white shadow"></span>
        </button>

        <button onclick="deleteAlarm('${alarm.id}')" class="text-slate-500 hover:text-rose-400 text-sm p-1" title="Delete alarm">
          ✕
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

// Initialize App
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
}
renderAlarms();
updateLiveClockAndCheckAlarms();
setInterval(updateLiveClockAndCheckAlarms, 1000);
