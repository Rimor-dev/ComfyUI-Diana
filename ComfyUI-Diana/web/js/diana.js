import { app } from "../../../scripts/app.js";

console.log("%c🧝 DIANA: v16.0 - Interactive Assistant", "color: #9b59b6; font-size: 16px; font-weight: bold");

// ==================== CORE STATE ====================
let diana = {
    // UI elements
    container: null,
    canvas: null,
    ctx: null,
    emotionSpan: null,
    phraseSpan: null,
    pinButton: null,
    audioButton: null,
    
    // Assets
    sprites: {},
    audio: {},
    phrases: {},
    emotions: [],
    frameCount: 16,
    
    // State
    currentEmotion: "neutral",
    currentFrame: 0,
    speed: 1.0,
    ready: false,
    audioEnabled: false,
    userActivated: false,
    
    // Cycle counters
    cyclesRemaining: 0,
    nextEmotion: null,
    
    // Phrase timer
    phraseTimer: 0,
    lastTimestamp: 0,
    
    // Animation cycles config
    cycles: {
        speaking: 1,
        happy: 1,
        surprised: 1,
        waiting: 0,
        greeting: 2,
        drag: 1  // drag reaction
    },
    
    // WebSocket
    ws: null,
    
    // UI state
    isPinned: false,
    isDragging: false,
    
    // Counters
    eventCount: 0,
    connected: false,
    reconnectAttempts: 0
};

const emotionIcons = {
    'neutral': '😐',
    'waiting': '⏳',
    'speaking': '🗣️',
    'happy': '😊',
    'surprised': '😲'
};

// ==================== UTILITIES ====================
function log(level, module, msg, data = null) {
    const timestamp = new Date().toISOString().substr(11, 8);
    const prefix = `[${timestamp}] [${module}]`;
    
    if (data) {
        console.log(`${prefix} ${msg}`, data);
    } else {
        console.log(`${prefix} ${msg}`);
    }
}

// ==================== ASSET LOADING ====================
async function loadLibrary() {
    log('info', 'LIB', '📥 Loading from /diana/library...');
    
    try {
        const response = await fetch('/diana/library');
        log('info', 'LIB', `📊 Status: ${response.status}`);
        
        if (!response.ok) {
            log('error', 'LIB', '❌ Failed to load library');
            return false;
        }
        
        const data = await response.json();
        log('info', 'LIB', '✅ Library loaded');
        
        diana.sprites = data.sprites;
        diana.audio = data.audio;
        diana.phrases = data.phrases;
        diana.emotions = data.metadata.emotions;
        diana.frameCount = data.metadata.frame_count;
        
        log('info', 'LIB', `  • Emotions: ${diana.emotions.length} (${diana.emotions.join(', ')})`);
        log('info', 'LIB', `  • Audio files: ${Object.keys(diana.audio).length} (${Object.keys(diana.audio).join(', ')})`);
        log('info', 'LIB', `  • Phrases: ${Object.keys(diana.phrases).length}`);
        
        return true;
        
    } catch (e) {
        log('error', 'LIB', `❌ Error: ${e.message}`);
        return false;
    }
}

// ==================== WEBSOCKET CONNECTION ====================
function connectToDiana() {
    const wsUrl = `ws://${window.location.host}/diana/events`;
    log('info', 'WS', `🔌 Connecting to ${wsUrl} (attempt ${diana.reconnectAttempts + 1})`);
    
    diana.ws = new WebSocket(wsUrl);
    
    diana.ws.onopen = () => {
        log('ok', 'WS', '✅ WebSocket OPEN');
        diana.connected = true;
        diana.reconnectAttempts = 0;
        updateStatusBadge('connected');
        
        // Send ping to test connection
        diana.ws.send(JSON.stringify({ type: "ping" }));
    };
    
    diana.ws.onmessage = (event) => {
        diana.eventCount++;
        
        log('raw', 'WS', `📨 RAW #${diana.eventCount}: ${event.data}`);
        
        try {
            const data = JSON.parse(event.data);
            log('event', 'WS', `📨 #${diana.eventCount}: ${data.type || 'unknown'}`);
            
            // Ignore events until user activates
            if (!diana.userActivated) {
                log('system', 'DIANA', `⏸️ Event ${data.type} ignored (user not activated)`);
                return;
            }
            
            if (data.type === 'start') {
                log('event', 'HANDLER', '🔥 START detected');
                handleEvent('start');
                
            } else if (data.type === 'complete') {
                log('event', 'HANDLER', '🔥 COMPLETE detected');
                handleEvent('complete');
                
            } else if (data.type === 'error') {
                log('event', 'HANDLER', '🔥 ERROR detected');
                handleEvent('error');
                
            } else if (data.type === 'waiting') {
                log('event', 'HANDLER', '⏳ WAITING detected');
                handleEvent('waiting');
                
            } else if (data.type === 'pong') {
                log('ok', 'WS', '✅ Connection alive');
            }
            
        } catch (e) {
            log('error', 'WS', `❌ Parse error: ${e.message}`);
            log('error', 'WS', `❌ Raw data: ${event.data}`);
        }
    };
    
    diana.ws.onerror = (error) => {
        log('error', 'WS', `❌ WebSocket error:`, error);
        diana.connected = false;
        updateStatusBadge('error');
    };
    
    diana.ws.onclose = () => {
        diana.reconnectAttempts++;
        log('warn', 'WS', `🔌 WebSocket closed, reconnecting in 3s... (attempt ${diana.reconnectAttempts})`);
        diana.connected = false;
        updateStatusBadge('disconnected');
        setTimeout(connectToDiana, 3000);
    };
}

// ==================== USER ACTIVATION ====================
function activateUser() {
    if (diana.userActivated) return;
    
    diana.userActivated = true;
    log('system', 'DIANA', '🌟 User activated! Diana is now alive');
    
    // Enable audio
    enableAudio();
    
    // Show greeting (animation + phrase)
    sayGreeting();
    
    // Remove activation handlers
    const events = ['click', 'keydown', 'touchstart', 'mousedown'];
    events.forEach(event => {
        document.removeEventListener(event, activateUser);
    });
}

// ==================== EVENT HANDLING ====================
function handleEvent(eventType) {
    log('event', 'HANDLER', `🔥 Processing event: ${eventType}`);
    
    if (!diana.sprites || Object.keys(diana.sprites).length === 0) {
        log('error', 'HANDLER', '❌ No sprites loaded!');
        return;
    }
    
    let emotion, cycles, nextEmotion, phraseKey;
    
    switch(eventType) {
        case 'start':
            emotion = 'speaking';
            cycles = 1;
            nextEmotion = 'waiting';
            phraseKey = 'start';
            log('event', 'HANDLER', `  → speaking (${cycles} cycle) → waiting`);
            break;
            
        case 'complete':
            emotion = 'happy';
            cycles = 1;
            nextEmotion = 'neutral';
            phraseKey = 'complete';
            log('event', 'HANDLER', `  → happy (${cycles} cycle) → neutral`);
            break;
            
        case 'error':
            emotion = 'surprised';
            cycles = 1;
            nextEmotion = 'neutral';
            phraseKey = 'error';
            log('event', 'HANDLER', `  → surprised (${cycles} cycle) → neutral`);
            break;
            
        case 'waiting':
            emotion = 'waiting';
            cycles = 0;
            nextEmotion = null;
            phraseKey = 'waiting';
            log('event', 'HANDLER', `  → waiting (infinite)`);
            break;
            
        default:
            log('warn', 'HANDLER', `  ⏭️ Unknown event: ${eventType}`);
            return;
    }
    
    // Set emotion
    setEmotion(emotion, cycles, nextEmotion);
    
    // Play audio
    playAudio(eventType);
    
    // Show phrase
    showRandomPhrase(phraseKey);
}

// ==================== EMOTIONS ====================
function setEmotion(emotion, cycles, nextEmotion = null) {
    log('emotion', 'EMOTION', `🎭 Setting: ${emotion} (${cycles} cycles) → ${nextEmotion || 'none'}`);
    
    if (!diana.sprites[emotion]) {
        log('warn', 'EMOTION', `⚠️ No sprites for emotion: ${emotion}`);
        if (diana.sprites['neutral']) {
            emotion = 'neutral';
        } else {
            return;
        }
    }
    
    diana.currentEmotion = emotion;
    diana.currentFrame = 0;
    diana.cyclesRemaining = cycles;
    diana.nextEmotion = nextEmotion;
    
    if (diana.emotionSpan) {
        const icon = emotionIcons[emotion] || '🧝';
        diana.emotionSpan.innerText = `${icon} ${emotion}`;
        log('emotion', 'EMOTION', `  ✅ UI updated to: ${icon} ${emotion}`);
    }
}

// ==================== ANIMATION LOOP ====================
function animate(timestamp) {
    if (!diana.ctx) {
        requestAnimationFrame(animate);
        return;
    }
    
    // Update phrase timer
    if (diana.lastTimestamp) {
        const deltaTime = (timestamp - diana.lastTimestamp) / 1000;
        
        if (diana.phraseTimer > 0) {
            diana.phraseTimer -= deltaTime;
            if (diana.phraseTimer <= 0 && diana.phraseSpan) {
                diana.phraseSpan.innerText = "💭 ...";
                log('timer', 'ANIM', `⏱️ Phrase timer done`);
            }
        }
    }
    diana.lastTimestamp = timestamp;
    
    // Draw sprite
    if (diana.sprites[diana.currentEmotion]) {
        const frames = diana.sprites[diana.currentEmotion];
        if (frames && frames.length > 0) {
            const frameDelay = 1000 / 12 / diana.speed;
            
            if (!diana.lastFrameTime || timestamp - diana.lastFrameTime > frameDelay) {
                diana.currentFrame = (diana.currentFrame + 1) % frames.length;
                diana.lastFrameTime = timestamp;
                
                if (diana.currentFrame === 0 && diana.cyclesRemaining > 0) {
                    diana.cyclesRemaining--;
                    log('cycles', 'ANIM', `⏱️ Cycles left: ${diana.cyclesRemaining}`);
                    
                    if (diana.cyclesRemaining === 0 && diana.nextEmotion) {
                        log('cycles', 'ANIM', `↩️ Switching to ${diana.nextEmotion}`);
                        setEmotion(diana.nextEmotion, 
                                  diana.nextEmotion === 'waiting' ? 0 : 0,
                                  null);
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
        // Placeholder
        diana.ctx.clearRect(0, 0, 128, 128);
        diana.ctx.fillStyle = "#333";
        diana.ctx.fillRect(0, 0, 128, 128);
        diana.ctx.fillStyle = "#9b59b6";
        diana.ctx.font = "bold 20px Arial";
        diana.ctx.fillText("🧝", 64, 64);
    }
    
    requestAnimationFrame(animate);
}

// ==================== AUDIO ====================
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function enableAudio() {
    if (diana.audioEnabled) return;
    
    diana.audioEnabled = true;
    
    if (diana.audioButton) {
        diana.audioButton.style.color = '#00ff00';
        diana.audioButton.innerHTML = '🔊';
        diana.audioButton.title = 'Sound enabled';
    }
    
    log('audio', 'AUDIO', '🔊 Audio enabled');
}

async function playAudio(eventType) {
    if (!diana.audioEnabled) return;
    
    const audioMap = {
        'start': 'start',
        'complete': 'complete',
        'error': 'error',
        'greeting': 'greeting',
        'waiting': 'waiting'
    };
    
    const audioName = audioMap[eventType];
    log('audio', 'AUDIO', `🔊 Attempting to play: ${audioName}`);
    
    if (!audioName) {
        log('warn', 'AUDIO', `  ⚠️ No mapping for event: ${eventType}`);
        return;
    }
    
    if (!diana.audio[audioName]) {
        log('warn', 'AUDIO', `  ⚠️ Audio file not found: ${audioName}`);
        return;
    }
    
    try {
        const base64Data = diana.audio[audioName];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        log('audio', 'AUDIO', `  • Decoded ${bytes.length} bytes`);
        
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = 0.7;
        
        audio.onplay = () => log('ok', 'AUDIO', `✅ Playing: ${audioName}`);
        audio.onerror = (e) => log('error', 'AUDIO', `❌ Play error: ${e.message}`);
        
        await audio.play();
        
    } catch (e) {
        log('error', 'AUDIO', `❌ Error: ${e.message}`);
    }
}

// ==================== PHRASES ====================
function showRandomPhrase(key) {
    log('phrase', 'PHRASE', `💬 Getting phrase for: ${key}`);
    
    if (!diana.phrases[key]) {
        log('warn', 'PHRASE', `  ⚠️ No phrase category: ${key}`);
        return;
    }
    
    const phrases = diana.phrases[key];
    if (!phrases || phrases.length === 0) {
        log('warn', 'PHRASE', `  ⚠️ Empty phrase list for: ${key}`);
        return;
    }
    
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    log('ok', 'PHRASE', `  ✅ Selected: "${phrase}"`);
    
    if (diana.phraseSpan) {
        diana.phraseSpan.innerText = `"${phrase}"`;
        diana.phraseTimer = 15.0;
        log('phrase', 'PHRASE', `  📝 Displaying for 15s`);
    }
}

// ==================== GREETING ====================
function sayGreeting() {
    log('system', 'DIANA', '👋 Diana here!');
    
    if (diana.phraseSpan) {
        if (diana.phrases && diana.phrases['greeting'] && diana.phrases['greeting'].length > 0) {
            const phrases = diana.phrases['greeting'];
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];
            diana.phraseSpan.innerText = `"${phrase}"`;
            diana.phraseTimer = 15.0;
        } else {
            diana.phraseSpan.innerText = '"Diana here!"';
            diana.phraseTimer = 15.0;
        }
    }
    
    playAudio('greeting');
    setEmotion('speaking', 2, 'neutral');
}

// ==================== DRAG REACTION ====================
function handleDragStart() {
    if (!diana.userActivated || diana.isDragging) return;
    
    diana.isDragging = true;
    log('emotion', 'DRAG', '🖐️ Drag started - showing surprise');
    
    // Show surprise for 1 cycle
    setEmotion('surprised', 1, diana.currentEmotion);
}

function handleDragEnd() {
    if (!diana.isDragging) return;
    
    diana.isDragging = false;
    log('emotion', 'DRAG', '✅ Drag ended');
}

// ==================== UI ====================
function updateStatusBadge(status) {
    const badge = document.getElementById('diana-status-badge');
    if (!badge) return;
    
    const colors = {
        'connected': '#00ff00',
        'disconnected': '#ffff00',
        'error': '#ff0000'
    };
    badge.style.color = colors[status] || '#ffff00';
    log('ui', 'UI', `📊 Status badge: ${status}`);
}

function togglePin() {
    diana.isPinned = !diana.isPinned;
    
    if (diana.pinButton) {
        diana.pinButton.style.color = diana.isPinned ? '#ffaa00' : '#ffffff';
    }
    
    if (diana.isPinned && diana.container) {
        diana.container.style.top = "auto";
        diana.container.style.bottom = "20px";
        diana.container.style.left = "auto";
        diana.container.style.right = "20px";
        log('ui', 'UI', `📌 Pinned`);
    } else {
        log('ui', 'UI', `📌 Unpinned`);
    }
}

// ==================== WINDOW CREATION ====================
async function createDianaWindow() {
    if (document.getElementById('diana-container')) return;
    
    log('ui', 'UI', '🪟 Creating window...');
    
    const container = document.createElement("div");
    container.id = "diana-container";
    container.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        width: 220px;
        background: #2a2a2a;
        border: 2px solid #9b59b6;
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
        background: #9b59b6;
        color: white;
        padding: 8px;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        cursor: ${diana.isPinned ? 'default' : 'move'};
        align-items: center;
    `;
    
    const headerLeft = document.createElement("span");
    headerLeft.style.cssText = `
        display: flex;
        align-items: center;
        gap: 5px;
        cursor: ${diana.isPinned ? 'default' : 'move'};
    `;
    headerLeft.innerHTML = `
        <span>🧝 Diana</span>
        <span style="font-size: 10px;" id="diana-status-badge">●</span>
    `;
    
    const headerRight = document.createElement("span");
    headerRight.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    // Sound button
    const audioBtn = document.createElement("span");
    audioBtn.innerHTML = "🔇";
    audioBtn.style.cssText = `
        cursor: pointer;
        padding: 0 4px;
        font-size: 14px;
        transition: all 0.2s;
        color: #ffffff;
    `;
    audioBtn.title = "Enable sound";
    audioBtn.onclick = activateUser;
    diana.audioButton = audioBtn;
    
    const pinBtn = document.createElement("span");
    pinBtn.innerHTML = "📌";
    pinBtn.style.cssText = `
        cursor: pointer;
        padding: 0 4px;
        font-size: 14px;
        transition: all 0.2s;
        color: #ffffff;
    `;
    pinBtn.title = "Pin to corner / Free movement";
    pinBtn.onclick = togglePin;
    diana.pinButton = pinBtn;
    
    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = "✕";
    closeBtn.style.cssText = `
        cursor: pointer;
        padding: 0 4px;
        font-size: 14px;
    `;
    closeBtn.onclick = () => container.remove();
    
    headerRight.appendChild(audioBtn);
    headerRight.appendChild(pinBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    canvas.style.cssText = `
        width: 128px;
        height: 128px;
        display: block;
        margin: 10px auto;
        background: #1a1a1a;
        border-radius: 5px;
    `;
    
    const emotionDiv = document.createElement("div");
    emotionDiv.id = "diana-emotion";
    emotionDiv.style.cssText = `
        text-align: center;
        color: #9b59b6;
        padding: 5px;
        font-size: 12px;
        font-weight: bold;
        background: #1a1a1a;
        margin: 0 5px 5px 5px;
        border-radius: 3px;
    `;
    emotionDiv.innerText = "😐 neutral";
    
    const phraseDiv = document.createElement("div");
    phraseDiv.id = "diana-phrase";
    phraseDiv.style.cssText = `
        text-align: center;
        color: #aaa;
        padding: 8px;
        font-size: 11px;
        font-style: italic;
        border-top: 1px solid #333;
        min-height: 40px;
        background: #1a1a1a;
        word-break: break-word;
    `;
    phraseDiv.innerText = "💭 ...";
    
    container.appendChild(header);
    container.appendChild(canvas);
    container.appendChild(emotionDiv);
    container.appendChild(phraseDiv);
    document.body.appendChild(container);
    
    diana.container = container;
    diana.canvas = canvas;
    diana.ctx = canvas.getContext("2d");
    diana.emotionSpan = emotionDiv;
    diana.phraseSpan = phraseDiv;
    
    // Draggable with reaction
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    header.onmousedown = (e) => {
        if (diana.isPinned) return;
        
        handleDragStart();
        
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        document.onmouseup = () => {
            handleDragEnd();
            document.onmouseup = null;
            document.onmousemove = null;
        };
        
        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
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
    
    // User activation on first click
    const events = ['click', 'keydown', 'touchstart', 'mousedown'];
    events.forEach(event => {
        document.addEventListener(event, activateUser, { once: true });
    });
    
    // Load assets
    const libLoaded = await loadLibrary();
    
    if (libLoaded) {
        requestAnimationFrame(animate);
        
        setTimeout(() => {
            log('system', 'MAIN', '🔌 Connecting to Diana...');
            connectToDiana();
        }, 2000);
    } else {
        log('error', 'MAIN', '❌ Library loading failed');
    }
}

// ==================== INIT ====================
log('system', 'MAIN', '🚀 Initializing...');

setTimeout(createDianaWindow, 2000);
window.addEventListener('load', () => {
    log('system', 'MAIN', '📄 Window load event');
    setTimeout(createDianaWindow, 1000);
});

app.registerExtension({
    name: "ComfyUI.Diana",
    async setup() {
        log('system', 'MAIN', '🧩 Extension ready');
    }
});