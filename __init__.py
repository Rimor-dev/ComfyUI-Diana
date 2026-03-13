import os
import json
import struct
import zlib
import base64
from pathlib import Path
from PIL import Image
import io
import server
from aiohttp import web
import threading

# ==================== GLOBAL STATE ====================
_current_library = None
_available_libraries = []

# ==================== ASSET LIBRARY ====================
class DianaLibrary:
    def __init__(self):
        self.metadata = {}
        self.sprites = {}
        self.audio = {}
        self.phrases = {}
        self.loaded = False
        self.name = "Unknown"
        self.color = "#9b59b6"
        self.bgcolor = "#4a2a5a"
    
    def load(self, lib_path):
        try:
            with open(lib_path, 'rb') as f:
                header = f.read(8).decode()
                if header != "DIANA2.0":
                    raise ValueError(f"Invalid library format: {header}")
                
                meta_len = struct.unpack('I', f.read(4))[0]
                compressed_meta = f.read(meta_len)
                self.metadata = json.loads(zlib.decompress(compressed_meta))
                
                self.name = self.metadata.get("name", lib_path.stem)
                self.color = self.metadata.get("color", "#9b59b6")
                self.bgcolor = self.metadata.get("bgcolor", "#4a2a5a")
                
                emotions = self.metadata.get("emotions", [])
                frame_count = self.metadata.get("frame_count", 16)
                
                print(f"\033[95m[Diana API]\033[0m 🎨 Loading {self.name}...")
                
                for emotion in emotions:
                    frames = []
                    for _ in range(frame_count):
                        frame_len = struct.unpack('I', f.read(4))[0]
                        compressed = f.read(frame_len)
                        img_bytes = zlib.decompress(compressed)
                        
                        # Преобразуем байты в изображение без numpy
                        from PIL import Image
                        import io
                        img = Image.frombytes('RGBA', (128, 128), img_bytes)
                        frames.append(img)
                    
                    self.sprites[emotion] = frames
                    print(f"\033[95m[Diana API]\033[0m   ✅ {emotion}")
                
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
                    print(f"\033[95m[Diana API]\033[0m   ✅ {name}")
                
                self.phrases = self.metadata.get("phrases", {})
            
            self.loaded = True
            print(f"\033[95m[Diana API]\033[0m ✅ Loaded: {self.name}")
            return self
        except Exception as e:
            print(f"\033[91m[Diana API]\033[0m ❌ Failed to load {lib_path.name}: {e}")
            import traceback
            traceback.print_exc()
            return self

def scan_libraries():
    global _available_libraries
    libs_folder = Path(__file__).parent / "libraries"
    if not libs_folder.exists():
        libs_folder.mkdir(exist_ok=True)
        print(f"\033[95m[Diana API]\033[0m 📁 Created libraries folder")
    
    _available_libraries = []
    for lib_file in libs_folder.glob("*.lib"):
        _available_libraries.append(lib_file.stem)
        print(f"\033[95m[Diana API]\033[0m 📦 Found: {lib_file.name}")

def load_library(lib_name):
    global _current_library
    lib_path = Path(__file__).parent / "libraries" / f"{lib_name}.lib"
    if not lib_path.exists():
        print(f"\033[91m[Diana API]\033[0m ❌ Library not found: {lib_name}")
        return False
    
    print(f"\033[95m[Diana API]\033[0m 📦 Loading: {lib_name}")
    _current_library = DianaLibrary().load(lib_path)
    return _current_library.loaded

# Сканируем при старте
scan_libraries()
if _available_libraries:
    load_library(_available_libraries[0])

# ==================== API ENDPOINTS ====================
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

@server.PromptServer.instance.routes.get("/diana/libraries")
async def get_libraries(request):
    return web.json_response({
        "libraries": _available_libraries,
        "current": _current_library.name if _current_library else None
    })

@server.PromptServer.instance.routes.post("/diana/library/load")
async def load_library_endpoint(request):
    try:
        data = await request.json()
        lib_name = data.get("library")
        if not lib_name:
            return web.json_response({"error": "No library"}, status=400)
        
        if load_library(lib_name):
            return web.json_response({"success": True})
        return web.json_response({"error": "Failed"}, status=404)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/diana/library/current")
async def get_current_library_endpoint(request):
    lib = _current_library
    if not lib or not lib.loaded:
        return web.Response(status=404)
    
    sprites_base64 = {}
    for emotion, frames in lib.sprites.items():
        sprites_base64[emotion] = []
        for img in frames:
            img_io = io.BytesIO()
            img.save(img_io, format='PNG')
            img_io.seek(0)
            sprites_base64[emotion].append(base64.b64encode(img_io.read()).decode())
    
    audio_base64 = {}
    for name, data in lib.audio.items():
        audio_base64[name] = base64.b64encode(data).decode()
    
    return web.json_response({
        "name": lib.name,
        "color": lib.color,
        "bgcolor": lib.bgcolor,
        "sprites": sprites_base64,
        "audio": audio_base64,
        "phrases": lib.phrases,
        "metadata": {
            "emotions": list(lib.sprites.keys()),
            "frame_count": len(next(iter(lib.sprites.values()))) if lib.sprites else 0
        }
    })

# ==================== WEB DIRECTORY ====================
WEB_DIRECTORY = "./web"

__all__ = []