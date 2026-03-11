import os
import json
import struct
import zlib
import base64
import time
import numpy as np
import asyncio
from pathlib import Path
from PIL import Image
import io
import server
from aiohttp import web
import threading
import traceback

# ==================== GLOBAL STATE ====================
_diana_listeners = []
_diana_listeners_lock = threading.Lock()
_diana_color = "#9b59b6"  # Signature purple color

# ==================== ASSET LIBRARY ====================
class DianaLibrary:
    """Diana unified asset loader (.diana format)"""
    
    def __init__(self):
        self.metadata = {}
        self.sprites = {}
        self.audio = {}
        self.phrases = {}
        self.loaded = False
    
    def load(self, lib_path):
        """Load library from .diana file"""
        try:
            with open(lib_path, 'rb') as f:
                # Check header (support both formats)
                header = f.read(8).decode()
                if header == "DIANA2.0":
                    pass  # Correct format
                else:
                    raise ValueError(f"Invalid library format: {header}")
                
                # Read metadata
                meta_len = struct.unpack('I', f.read(4))[0]
                compressed_meta = f.read(meta_len)
                self.metadata = json.loads(zlib.decompress(compressed_meta))
                
                # Load sprites
                emotions = self.metadata.get("emotions", [])
                frame_count = self.metadata.get("frame_count", 16)
                
                print(f"\033[95m[Library]\033[0m 🎨 Loading {len(emotions)} emotions with {frame_count} frames...")
                
                for emotion in emotions:
                    frames = []
                    for _ in range(frame_count):
                        frame_len = struct.unpack('I', f.read(4))[0]
                        compressed = f.read(frame_len)
                        img_bytes = zlib.decompress(compressed)
                        img_array = np.frombuffer(img_bytes, dtype=np.uint8).reshape(128, 128, 4)
                        img = Image.fromarray(img_array, 'RGBA')
                        frames.append(img)
                    self.sprites[emotion] = frames
                    print(f"\033[95m[Library]\033[0m   ✅ {emotion}: {len(frames)} frames")
                
                # Load audio files
                print(f"\033[95m[Library]\033[0m 🔊 Loading audio files...")
                audio_count = 0
                while True:
                    pos = f.tell()
                    check = f.read(9)
                    if check == b"DIANA_END" or len(check) < 9:
                        break
                    f.seek(pos)
                    
                    name_len = struct.unpack('I', f.read(4))[0]
                    name = f.read(name_len).decode()
                    audio_len = struct.unpack('I', f.read(4))[0]
                    audio_data = f.read(audio_len)
                    self.audio[name] = audio_data
                    audio_count += 1
                    print(f"\033[95m[Library]\033[0m   ✅ {name}: {audio_len} bytes")
                
                # Phrases from metadata
                self.phrases = self.metadata.get("phrases", {})
            
            self.loaded = True
            print(f"\033[95m[Library]\033[0m ✅ Loaded: {len(self.sprites)} emotions, {len(self.audio)} audio")
            return self
        except Exception as e:
            print(f"\033[91m[Library]\033[0m ❌ Failed to load: {e}")
            traceback.print_exc()
            return self

# ==================== GLOBAL LIBRARY ====================
_diana_lib = None
_lib_path = Path(__file__).parent / "diana.lib"

def get_diana_lib():
    """Get or load the Diana library"""
    global _diana_lib
    if _diana_lib is None and _lib_path.exists():
        print(f"\033[95m[Library]\033[0m 📦 Loading library from: {_lib_path}")
        _diana_lib = DianaLibrary().load(_lib_path)
    elif _diana_lib is None:
        print(f"\033[93m[Library]\033[0m ⚠️ Library not found at: {_lib_path}")
        _diana_lib = DianaLibrary()
    return _diana_lib

# ==================== API ENDPOINTS ====================
def add_cors(response):
    """Add CORS headers to response"""
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@server.PromptServer.instance.routes.get("/diana/library")
async def get_library(request):
    """Serve the entire library as JSON"""
    lib = get_diana_lib()
    if not lib or not lib.loaded:
        return web.Response(status=404, text="Library not found")
    
    # Convert sprites to base64
    sprites_base64 = {}
    for emotion, frames in lib.sprites.items():
        sprites_base64[emotion] = []
        for img in frames:
            img_io = io.BytesIO()
            img.save(img_io, format='PNG')
            img_io.seek(0)
            sprites_base64[emotion].append(base64.b64encode(img_io.read()).decode())
    
    # Convert audio to base64
    audio_base64 = {}
    for name, data in lib.audio.items():
        audio_base64[name] = base64.b64encode(data).decode()
    
    return web.json_response({
        "sprites": sprites_base64,
        "audio": audio_base64,
        "phrases": lib.phrases,
        "metadata": {
            "emotions": list(lib.sprites.keys()),
            "frame_count": len(next(iter(lib.sprites.values()))) if lib.sprites else 0
        }
    })

@server.PromptServer.instance.routes.get("/diana/events")
async def diana_events(request):
    """WebSocket endpoint for Diana to receive ComfyUI events"""
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    with _diana_listeners_lock:
        _diana_listeners.append(ws)
        print(f"\033[95m[Diana]\033[0m 👥 Diana connected. Total: {len(_diana_listeners)}")
    
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    if data.get("type") == "ping":
                        await ws.send_json({"type": "pong"})
                except Exception as e:
                    print(f"\033[91m[Diana]\033[0m ❌ Error processing message: {e}")
    except Exception as e:
        print(f"\033[91m[Diana]\033[0m ❌ WebSocket error: {e}")
    finally:
        with _diana_listeners_lock:
            if ws in _diana_listeners:
                _diana_listeners.remove(ws)
                print(f"\033[95m[Diana]\033[0m 👋 Diana disconnected")
    return ws

@server.PromptServer.instance.routes.options("/diana/events")
async def options_diana(request):
    """CORS preflight for WebSocket"""
    return add_cors(web.Response())

# ==================== COMFYUI EVENT RELAY ====================
_original_prompt_queue_put = None
_original_task_done = None

def setup_event_hooks():
    """Setup ComfyUI event hooks and relay to Diana"""
    global _original_prompt_queue_put, _original_task_done
    
    prompt_queue = server.PromptServer.instance.prompt_queue
    _original_prompt_queue_put = prompt_queue.put
    _original_task_done = getattr(prompt_queue, 'task_done', None)
    
    def patched_put(self, item, *args, **kwargs):
        """Intercept task start and notify Diana"""
        asyncio.run_coroutine_threadsafe(
            broadcast_to_diana("start"),
            server.PromptServer.instance.loop
        )
        return _original_prompt_queue_put(item, *args, **kwargs)
    
    def patched_task_done(self, *args, **kwargs):
        """Intercept task completion and notify Diana"""
        asyncio.run_coroutine_threadsafe(
            broadcast_to_diana("complete"),
            server.PromptServer.instance.loop
        )
        if _original_task_done:
            return _original_task_done(*args, **kwargs)
        return None
    
    prompt_queue.put = patched_put.__get__(prompt_queue, type(prompt_queue))
    if _original_task_done:
        prompt_queue.task_done = patched_task_done.__get__(prompt_queue, type(prompt_queue))
    
    print(f"\033[95m[Diana]\033[0m ✅ Event hooks installed")

async def broadcast_to_diana(event_type):
    """Broadcast event to all connected Diana clients"""
    event_data = {
        "type": event_type,
        "timestamp": time.time()
    }
    
    with _diana_listeners_lock:
        listeners = _diana_listeners.copy()
    
    for ws in listeners:
        try:
            await ws.send_json(event_data)
        except:
            with _diana_listeners_lock:
                if ws in _diana_listeners:
                    _diana_listeners.remove(ws)

# ==================== MAIN NODE ====================
class Diana:
    """🧝 Diana - Interactive Assistant for ComfyUI"""
    
    CATEGORY = "diana"
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},  # Empty! No nothing!
            "optional": {
                "signal_1": ("*", {}),  # Any type, optional
                "signal_2": ("*", {}),  # Any type, optional
                "signal_3": ("*", {}),  # Any type, optional
            }
        }
    
    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("heartbeat",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    
    def __init__(self):
        print(f"\n\033[95m{'='*60}\033[0m")
        print(f"\033[95m🧝 DIANA - Interactive Assistant\033[0m")
        print(f"\033[95m{'='*60}\033[0m")
        lib = get_diana_lib()
        if lib and lib.loaded:
            print(f"  \033[95m✅\033[0m Library: {len(lib.sprites)} emotions, {len(lib.audio)} audio")
            print(f"  \033[95m✅\033[0m Library endpoint: /diana/library")
            print(f"  \033[95m✅\033[0m WebSocket endpoint: /diana/events")
            print(f"  \033[95m✅\033[0m 3 input signals ready")
            print(f"  \033[95m✅\033[0m Heartbeat output ready")
        else:
            print(f"  \033[93m⚠️\033[0m Library not found at: {_lib_path}")
        
        # Setup event hooks
        setup_event_hooks()
        
        print(f"\033[95m{'='*60}\033[0m\n")
    
    def run(self, signal_1=None, signal_2=None, signal_3=None):
        """Run the node - signals can be used for future extensions"""
        # Currently just returns a heartbeat
        return ("❤️",)

NODE_CLASS_MAPPINGS = {
    "Diana": Diana,
}