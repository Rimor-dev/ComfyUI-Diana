import { app } from "../../../scripts/app.js";

console.log("%c🧝 DIANA: v34.3 - IDLE TIMER", "color: #9b59b6; font-size: 16px; font-weight: bold");

let diana = {
    container: null,
    canvas: null,
    ctx: null,
    emotionSpan: null,
    phraseSpan: null,
    pinButton: null,
    audioButton: null,
    nameSpan: null,
    header: null,
    libNameSpan: null,
    libPrevBtn: null,
    libNextBtn: null,
    
    sprites: {},
    audio: {},
    phrases: {},
    emotions: [],
    frameCount: 16,
    libraryName: "Unknown",
    libraryColor: "#9b59b6",
    libraryBgColor: "#1a1a1a",
    libraries: [],
    currentLibIndex: 0,
    
    currentEmotion: "neutral",
    currentFrame: 0,
    speed: 1.0,
    ready: false,
    audioEnabled: true,
    userActivated: false,
    workflowActive: false,
    
    cyclesRemaining: 0,
    nextEmotion: null,
    phraseTimer: 0,
    lastTimestamp: 0,
    
    animationSpeed: 10,
    cycles: {
        speaking: 1,
        happy: 1,
        surprised: 1,
        greeting: 1,
        drag: 1
    },
    
    isPinned: false,
    isDragging: false,
    
    eventCount: 0,
    lastTaskId: null
};

const emotionIcons = {
    'neutral': '😐',
    'waiting': '⏳',
    'speaking': '🗣️',
    'happy': '😊',
    'surprised': '😲'
};

function log(level, module, msg, data = null) {
    const timestamp = new Date().toISOString().substr(11, 8);
    const prefix = `[${timestamp}] [${module}]`;
    data ? console.log(`${prefix} ${msg}`, data) : console.log(`${prefix} ${msg}`);
}

// ==================== AUDIO TOGGLE ====================
function toggleAudio() {
    if (!diana.userActivated) {
        // Первый клик на кнопку (если ещё не активировано)
        diana.userActivated = true;
        diana.audioEnabled = true;
        if (diana.audioButton) {
            diana.audioButton.style.color = '#00ff00';
            diana.audioButton.innerHTML = '🔊';
        }
        sayGreeting();
        startQueueMonitor();
        resetIdleTimer(); // ← ЗАПУСКАЕМ ТАЙМЕР
        
        // Удаляем слушатели активации
        const events = ['click', 'keydown', 'touchstart', 'mousedown'];
        events.forEach(e => document.removeEventListener(e, activateUser));
        
        log('system', 'AUDIO', '🔊 Audio enabled (first activation)');
    } else {
        // Уже активировано - просто переключаем звук
        diana.audioEnabled = !diana.audioEnabled;
        
        if (diana.audioButton) {
            if (diana.audioEnabled) {
                diana.audioButton.style.color = '#00ff00';
                diana.audioButton.innerHTML = '🔊';
                log('system', 'AUDIO', '🔊 Audio enabled');
            } else {
                diana.audioButton.style.color = '#ff0000';
                diana.audioButton.innerHTML = '🔇';
                log('system', 'AUDIO', '🔇 Audio disabled');
            }
        }
        resetIdleTimer(); // ← СБРАСЫВАЕМ ТАЙМЕР
    }
}

// ==================== IDLE TIMER WITH RANDOM OFFSET ====================
let idleTimer = null;
const IDLE_BASE_TIME = 2 * 60 * 1000; // 10 минут в миллисекундах
const RANDOM_OFFSET_MIN = 1 * 60 * 1000; // 1 минута
const RANDOM_OFFSET_MAX = 3 * 60 * 1000; // 3 минуты

function getRandomIdleTime() {
    // Базовое время + случайный оффсет от 1 до 3 минут
    const offset = Math.floor(Math.random() * (RANDOM_OFFSET_MAX - RANDOM_OFFSET_MIN + 1)) + RANDOM_OFFSET_MIN;
    const totalTime = IDLE_BASE_TIME + offset;
    console.log(`%c⏱️ Idle timer: ${IDLE_BASE_TIME/60000}min + ${offset/60000}min = ${totalTime/60000}min`, 'color: #ffaa00');
    return totalTime;
}

function resetIdleTimer() {
    // Очищаем существующий таймер
    if (idleTimer) {
        clearTimeout(idleTimer);
    }
    
    // Запускаем новый только если пользователь активирован
    if (!diana.userActivated) return;
    
    const idleTime = getRandomIdleTime();
    idleTimer = setTimeout(() => {
        // Проверяем, что не идёт генерация
        if (!diana.workflowActive) {
            console.log('%c⏰ IDLE TIMER TRIGGERED', 'color: #ffaa00; font-weight: bold');
            
            // Проигрываем waiting с анимацией speaking
            setEmotion('speaking', diana.cycles.speaking || 1, 'neutral');
            playAudio('waiting');
            showRandomPhrase('waiting');
            
            // Сбрасываем таймер после срабатывания
            resetIdleTimer();
        } else {
            // Если идёт генерация, пробуем позже
            console.log('%c⏱️ Workflow active, rescheduling idle timer', 'color: #ffaa00');
            resetIdleTimer();
        }
    }, idleTime);
    
    log('system', 'IDLE', `⏱️ Timer set for ${idleTime/60000} minutes`);
}

// ==================== LIBRARY MANAGEMENT ====================
async function fetchLibraries() {
    try {
        const response = await fetch('/diana/libraries');
        const data = await response.json();
        diana.libraries = data.libraries || [];
        diana.currentLibIndex = 0;
        if (diana.libraries.length > 0) {
            await switchToIndex(0);
        }
        return diana.libraries;
    } catch (e) {
        log('error', 'LIB', `❌ Failed: ${e.message}`);
        return [];
    }
}

async function switchToIndex(index) {
    if (index < 0) index = diana.libraries.length - 1;
    if (index >= diana.libraries.length) index = 0;
    
    diana.currentLibIndex = index;
    const libName = diana.libraries[index];
    
    try {
        const response = await fetch('/diana/library/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ library: libName })
        });
        const data = await response.json();
        if (data.success) {
            await loadCurrentLibrary();
            if (diana.libNameSpan) {
                diana.libNameSpan.innerText = libName;
            }
            log('info', 'LIB', `✅ Switched to ${libName}`);
        }
    } catch (e) {
        log('error', 'LIB', `❌ Switch failed: ${e.message}`);
    }
}

function prevLibrary() {
    switchToIndex(diana.currentLibIndex - 1);
}

function nextLibrary() {
    switchToIndex(diana.currentLibIndex + 1);
}

async function loadCurrentLibrary() {
    try {
        const response = await fetch('/diana/library/current');
        if (!response.ok) return false;
        const data = await response.json();
        
        diana.libraryName = data.name;
        diana.libraryColor = data.color || '#9b59b6';
        diana.libraryBgColor = data.bgcolor || '#1a1a1a';
        diana.sprites = data.sprites;
        diana.audio = data.audio;
        diana.phrases = data.phrases;
        diana.emotions = data.metadata.emotions;
        diana.frameCount = data.metadata.frame_count;
        
        if (diana.nameSpan) diana.nameSpan.innerText = `🧝 ${diana.libraryName}`;
        if (diana.container) diana.container.style.borderColor = diana.libraryColor;
        if (diana.header) diana.header.style.backgroundColor = diana.libraryColor;
        
        log('info', 'LIB', `✅ Loaded: ${diana.libraryName}`);
        return true;
    } catch (e) {
        log('error', 'LIB', `❌ Error: ${e.message}`);
        return false;
    }
}

async function fetchConfig() {
    try {
        const response = await fetch('/diana/config');
        const data = await response.json();
        diana.animationSpeed = data.speed || 12;
        diana.cycles = data.cycles || diana.cycles;
        return true;
    } catch (e) {
        return false;
    }
}

// ==================== QUEUE MONITOR WITH OUTPUT DETECTOR ====================
let lastQueueRunning = 0;
let lastQueuePending = 0;
let lastQueueState = 'idle'; // 'idle', 'running'
let lastProcessedTaskId = null;

async function checkQueue() {
    try {
        const response = await fetch('/queue');
        const data = await response.json();
        
        const running = data.queue_running?.length || 0;
        const pending = data.queue_pending?.length || 0;
        
        // ===== СТАРТ =====
        if (running > 0 && lastQueueState === 'idle') {
            console.log('%c🔥 START', 'color: #9b59b6');
            lastQueueState = 'running';
            lastProcessedTaskId = null;
            handleEvent('start');
            lastQueueRunning = running;
            lastQueuePending = pending;
            return;
        }
        
        // ===== ПРОВЕРКА РЕЗУЛЬТАТА =====
        if (running === 0 && pending === 0 && lastQueueState === 'running') {
            console.log('%c⏳ Checking result...', 'color: #9b59b6');
            
            // Ждем немного
            await new Promise(resolve => setTimeout(resolve, 300));
            
            try {
                const historyResponse = await fetch('/history');
                const historyData = await historyResponse.json();
                
                const tasks = Object.entries(historyData);
                if (tasks.length > 0) {
                    // Берем последнюю задачу
                    const [taskId, taskData] = tasks[tasks.length - 1];
                    
                    // Проверяем, не обрабатывали ли уже
                    if (taskId === lastProcessedTaskId) {
                        lastQueueState = 'idle';
                        return;
                    }
                    
                    lastProcessedTaskId = taskId;
                    
                    // Проверяем наличие выходных изображений
                    const hasOutputs = taskData.outputs && 
                                      Object.keys(taskData.outputs).length > 0;
                    
                    // 🎯 ПРОСТАЯ ЛОГИКА:
                    // Если есть outputs - успех, иначе - ошибка
                    if (hasOutputs) {
                        console.log('%c✅ COMPLETE', 'color: #00ff00');
                        handleEvent('complete');
                    } else {
                        console.log('%c❌ ERROR', 'color: #ff0000');
                        handleEvent('error');
                    }
                }
            } catch (e) {
                console.log('%c❌ History error', 'color: #ff0000');
            }
            
            // ВСЕГДА сбрасываем состояние
            lastQueueState = 'idle';
        }
        
        lastQueueRunning = running;
        lastQueuePending = pending;
        
    } catch (e) {
        console.log('%c❌ Queue error', 'color: #ff0000');
    }
}
//---------------------------------end monitor------------------------------------------

function startQueueMonitor() {
    setInterval(async () => {
        await checkQueue();
    }, 500);
    
    log('system', 'QUEUE', '👀 Queue monitor started');
}

function activateUser() {
    if (diana.userActivated) return;
    
    diana.userActivated = true;
    
    if (diana.audioButton) {
        diana.audioButton.style.color = '#00ff00';
        diana.audioButton.innerHTML = '🔊';
    }
    
    sayGreeting();
    startQueueMonitor();
    resetIdleTimer(); // ← ЗАПУСКАЕМ ТАЙМЕР
    
    const events = ['click', 'keydown', 'touchstart', 'mousedown'];
    events.forEach(e => document.removeEventListener(e, activateUser));
    
    log('system', 'USER', '🌟 User activated by click');
}

function handleEvent(eventType) {
    // Сбрасываем таймер при любом событии
    if (diana.userActivated) {
        resetIdleTimer();
    }
    
    if (!diana.sprites || Object.keys(diana.sprites).length === 0) return;
    
    let emotion, cycles, nextEmotion, phraseKey;
    
    switch(eventType) {
        case 'start':
            diana.workflowActive = true;
            emotion = 'speaking';
            cycles = diana.cycles.speaking;
            nextEmotion = 'waiting';
            phraseKey = 'start';
            log('event', 'HANDLER', `  → speaking (${cycles}) → waiting`);
            break;
            
        case 'complete':
            diana.workflowActive = false;
            emotion = 'happy';
            cycles = diana.cycles.happy;
            nextEmotion = 'neutral';
            phraseKey = 'complete';
            log('event', 'HANDLER', `  → happy (${cycles}) → neutral`);
            break;
            
        case 'error':
            diana.workflowActive = false;
            emotion = 'surprised';
            cycles = diana.cycles.surprised;
            nextEmotion = 'neutral';
            phraseKey = 'error';
            log('event', 'HANDLER', `  → surprised (${cycles}) → neutral`);
            break;
            
        default: return;
    }
    
    setEmotion(emotion, cycles, nextEmotion);
    playAudio(eventType);
    showRandomPhrase(phraseKey);
}

function setEmotion(emotion, cycles, nextEmotion = null) {
    if (!diana.sprites[emotion]) emotion = 'neutral';
    
    diana.currentEmotion = emotion;
    diana.currentFrame = 0;
    diana.cyclesRemaining = cycles;
    diana.nextEmotion = nextEmotion;
    
    if (diana.emotionSpan) {
        const icon = emotionIcons[emotion] || '🧝';
        diana.emotionSpan.innerText = `${icon} ${emotion}`;
    }
}

function animate(timestamp) {
    if (!diana.ctx) return requestAnimationFrame(animate);
    
    if (diana.lastTimestamp) {
        const deltaTime = (timestamp - diana.lastTimestamp) / 1000;
        if (diana.phraseTimer > 0) {
            diana.phraseTimer -= deltaTime;
            if (diana.phraseTimer <= 0 && diana.phraseSpan) {
                diana.phraseSpan.innerText = "💭 ...";
            }
        }
    }
    diana.lastTimestamp = timestamp;
    
    if (diana.sprites[diana.currentEmotion]) {
        const frames = diana.sprites[diana.currentEmotion];
        if (frames?.length > 0) {
            const frameDelay = 1000 / diana.animationSpeed / diana.speed;
            
            if (!diana.lastFrameTime || timestamp - diana.lastFrameTime > frameDelay) {
                diana.currentFrame = (diana.currentFrame + 1) % frames.length;
                diana.lastFrameTime = timestamp;
                
                if (diana.currentFrame === 0 && diana.cyclesRemaining > 0) {
                    diana.cyclesRemaining--;
                    if (diana.cyclesRemaining === 0 && diana.nextEmotion) {
                        let returnEmotion = diana.nextEmotion;
                        diana.nextEmotion = null;
                        setEmotion(returnEmotion, 0, null);
                    }
                }
            }
            
            const img = new Image();
            img.src = 'data:image/png;base64,' + frames[diana.currentFrame];
            img.onload = () => {
                diana.ctx.clearRect(0, 0, 128, 128);
                diana.ctx.drawImage(img, 0, 0, 128, 128);
            };
        }
    } else {
        diana.ctx.clearRect(0, 0, 128, 128);
        diana.ctx.fillStyle = "#333";
        diana.ctx.fillRect(0, 0, 128, 128);
        diana.ctx.fillStyle = "#9b59b6";
        diana.ctx.font = "bold 20px Arial";
        diana.ctx.fillText("🧝", 64, 64);
    }
    
    requestAnimationFrame(animate);
}

async function playAudio(eventType) {
    if (!diana.audioEnabled) return;
    
    const audioMap = {
        'start': 'start', 'complete': 'complete', 'error': 'error',
        'greeting': 'greeting', 'waiting': 'waiting'  // ← ДОБАВЛЕНО waiting
    };
    
    const audioName = audioMap[eventType];
    if (!audioName || !diana.audio[audioName]) return;
    
    try {
        const base64Data = diana.audio[audioName];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = 0.7;
        await audio.play();
    } catch (e) {
        log('error', 'AUDIO', `❌ Playback failed: ${e.message}`);
    }
}

function showRandomPhrase(key) {
    if (!diana.phrases[key]?.length) return;
    const phrases = diana.phrases[key];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    if (diana.phraseSpan) {
        diana.phraseSpan.innerText = `"${phrase}"`;
        diana.phraseTimer = 15.0;
    }
}

function sayGreeting() {
    if (diana.phraseSpan) {
        if (diana.phrases?.greeting?.length) {
            const phrases = diana.phrases.greeting;
            diana.phraseSpan.innerText = `"${phrases[Math.floor(Math.random() * phrases.length)]}"`;
            diana.phraseTimer = 15.0;
        } else {
            diana.phraseSpan.innerText = '"Diana here!"';
            diana.phraseTimer = 15.0;
        }
    }
    playAudio('greeting');
    setEmotion('speaking', diana.cycles.greeting, 'neutral');
}

function handleDragStart() {
    // Сбрасываем таймер при начале перетаскивания
    if (diana.userActivated) {
        resetIdleTimer();
    }
    
    if (!diana.userActivated || diana.isDragging) return;
    
    diana.isDragging = true;
    let returnEmotion = diana.workflowActive ? 'waiting' : 'neutral';
    setEmotion('surprised', diana.cycles.drag, returnEmotion);
}

function handleDragEnd() {
    // Сбрасываем таймер при окончании перетаскивания
    if (diana.userActivated) {
        resetIdleTimer();
    }
    
    if (!diana.isDragging) return;
    diana.isDragging = false;
}

function updateStatusBadge(status) {
    const badge = document.getElementById('diana-status-badge');
    if (!badge) return;
    const colors = { 'connected': '#00ff00', 'disconnected': '#ffff00', 'error': '#ff0000' };
    badge.style.color = colors[status] || '#ffff00';
}

function togglePin() {
    diana.isPinned = !diana.isPinned;
    if (diana.pinButton) diana.pinButton.style.color = diana.isPinned ? '#ffaa00' : '#ffffff';
    if (diana.isPinned && diana.container) {
        diana.container.style.top = "auto";
        diana.container.style.bottom = "20px";
        diana.container.style.left = "auto";
        diana.container.style.right = "20px";
    }
    resetIdleTimer(); // ← СБРАСЫВАЕМ ТАЙМЕР
}

async function createDianaWindow() {
    if (document.getElementById('diana-container')) return;
    
    await fetchLibraries();
    await loadCurrentLibrary();
    await fetchConfig();
    
    const container = document.createElement("div");
    container.id = "diana-container";
    container.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        width: 220px;
        background: #1A1A1A;
        border: 2px solid ${diana.libraryColor};
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        z-index: 999999;
        overflow: hidden;
        font-family: 'Segoe UI', sans-serif;
        user-select: none;
        cursor: default;
    `;
    
    const header = document.createElement("div");
    header.style.cssText = `
        background: ${diana.libraryColor};
        color: white;
        padding: 8px;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        cursor: ${diana.isPinned ? 'default' : 'move'};
        align-items: center;
    `;
    diana.header = header;
    
    const headerLeft = document.createElement("span");
    headerLeft.style.cssText = `display: flex; align-items: center; gap: 5px; cursor: ${diana.isPinned ? 'default' : 'move'};`;
    headerLeft.innerHTML = `<span class="diana-name">🧝 ${diana.libraryName}</span><span style="font-size: 10px;" id="diana-status-badge">●</span>`;
    diana.nameSpan = headerLeft.querySelector('.diana-name');
    
    const headerRight = document.createElement("span");
    headerRight.style.cssText = `display: flex; align-items: center; gap: 8px;`;
    
    const audioBtn = document.createElement("span");
    audioBtn.innerHTML = "🔊";
    audioBtn.style.cssText = `cursor: pointer; padding: 0 4px; font-size: 14px; color: #00ff00;`;
    audioBtn.onclick = toggleAudio;
    diana.audioButton = audioBtn;
    
    const pinBtn = document.createElement("span");
    pinBtn.innerHTML = "📌";
    pinBtn.style.cssText = `cursor: pointer; padding: 0 4px; font-size: 14px; color: #ffffff;`;
    pinBtn.onclick = togglePin;
    diana.pinButton = pinBtn;
    
    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = "✕";
    closeBtn.style.cssText = `cursor: pointer; padding: 0 4px; font-size: 14px;`;
    closeBtn.onclick = () => container.remove();
    
    headerRight.appendChild(audioBtn);
    headerRight.appendChild(pinBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    canvas.style.cssText = `width: 128px; height: 128px; display: block; margin: 10px auto; background: #1a1a1a; border-radius: 5px;`;
    
    const emotionDiv = document.createElement("div");
    emotionDiv.id = "diana-emotion";
    emotionDiv.style.cssText = `text-align: center; color: #9b59b6; padding: 5px; font-size: 12px; font-weight: bold; background: #1a1a1a; margin: 0 5px 5px 5px; border-radius: 3px;`;
    emotionDiv.innerText = "😐 neutral";
    
    const phraseDiv = document.createElement("div");
    phraseDiv.id = "diana-phrase";
    phraseDiv.style.cssText = `text-align: center; color: #aaa; padding: 8px; font-size: 11px; font-style: italic; border-top: 1px solid #333; min-height: 40px; background: #1a1a1a; word-break: break-word;`;
    phraseDiv.innerText = "💭 ...";
    
    const libSelector = document.createElement("div");
    libSelector.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px;
        border-top: 1px solid #333;
        background: #1a1a1a;
    `;
    
    const prevBtn = document.createElement("button");
    prevBtn.innerHTML = "◀";
    prevBtn.style.cssText = `
        background: ${diana.libraryColor};
        color: white;
        border: none;
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        opacity: 0.8;
        transition: opacity 0.2s;
    `;
    prevBtn.onmouseover = () => prevBtn.style.opacity = '1';
    prevBtn.onmouseout = () => prevBtn.style.opacity = '0.8';
    prevBtn.onclick = prevLibrary;
    diana.libPrevBtn = prevBtn;
    
    const libNameSpan = document.createElement("span");
    libNameSpan.style.cssText = `
        color: white;
        font-size: 12px;
        font-weight: bold;
        text-align: center;
        flex: 1;
        margin: 0 8px;
        text-transform: uppercase;
    `;
    libNameSpan.innerText = diana.libraryName;
    diana.libNameSpan = libNameSpan;
    
    const nextBtn = document.createElement("button");
    nextBtn.innerHTML = "▶";
    nextBtn.style.cssText = `
        background: ${diana.libraryColor};
        color: white;
        border: none;
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        opacity: 0.8;
        transition: opacity 0.2s;
    `;
    nextBtn.onmouseover = () => nextBtn.style.opacity = '1';
    nextBtn.onmouseout = () => nextBtn.style.opacity = '0.8';
    nextBtn.onclick = nextLibrary;
    diana.libNextBtn = nextBtn;
    
    libSelector.appendChild(prevBtn);
    libSelector.appendChild(libNameSpan);
    libSelector.appendChild(nextBtn);
    
    container.appendChild(header);
    container.appendChild(canvas);
    container.appendChild(emotionDiv);
    container.appendChild(phraseDiv);
    container.appendChild(libSelector);
    document.body.appendChild(container);
    
    diana.container = container;
    diana.canvas = canvas;
    diana.ctx = canvas.getContext("2d");
    diana.emotionSpan = emotionDiv;
    diana.phraseSpan = phraseDiv;
    
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    header.onmousedown = (e) => {
        if (diana.isPinned) return;
        handleDragStart();
        e.preventDefault();
        pos3 = e.clientX; pos4 = e.clientY;
        
        document.onmouseup = () => {
            handleDragEnd();
            document.onmouseup = null;
            document.onmousemove = null;
        };
        
        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            
            let newTop = container.offsetTop - pos2;
            let newLeft = container.offsetLeft - pos1;
            newTop = Math.max(0, Math.min(window.innerHeight - container.offsetHeight, newTop));
            newLeft = Math.max(0, Math.min(window.innerWidth - container.offsetWidth, newLeft));
            
            container.style.top = newTop + "px";
            container.style.left = newLeft + "px";
            container.style.bottom = "auto";
            container.style.right = "auto";
        };
    };
    
    const events = ['click', 'keydown', 'touchstart', 'mousedown'];
    events.forEach(e => document.addEventListener(e, activateUser, { once: true }));
    
    requestAnimationFrame(animate);
    log('system', 'MAIN', '✨ Diana ready');
}

setTimeout(createDianaWindow, 2000);
window.addEventListener('load', () => setTimeout(createDianaWindow, 1000));

app.registerExtension({
    name: "ComfyUI.Diana",
    async setup() {
        setTimeout(() => {
            if (!app.graph) return;
            app.graph._nodes.forEach(node => {
                if (node.type === "Diana") {
                    node.color = "#9b59b6";
                    node.bgcolor = "#1a1a1a";
                }
            });
        }, 1000);
    }
});