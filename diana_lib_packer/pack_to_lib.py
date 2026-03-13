#!/usr/bin/env python3
"""
Diana Sprite and Audio Packer
Creates a single .diana file containing all sprites, audio, and phrases
"""

import os
import json
import struct
import zlib
from PIL import Image
from pathlib import Path

class DianaPacker:
    def __init__(self):
        self.version = "DIANA2.0"
        self.data = {
            "metadata": {
                "name": "Diana",
                "version": "1.0.0",
                "author": "Unknown",
                "color": "#9b59b6",
                "bgcolor": "#4a2a5a",
                "emotions": [],
                "phrases": {},
                "frame_count": 16,
                "sprite_size": 128,
                "voice": {
                    "pitch": 1.0,
                    "speed": 1.0,
                    "format": "mp3"
                }
            },
            "sprites": {},
            "audio": {}
        }
    
    def add_sprites(self, folder_path):
        """Add all PNG sprites from folder"""
        folder = Path(folder_path)
        if not folder.exists():
            print(f"❌ Sprite folder not found: {folder}")
            return
        
        png_files = sorted(folder.glob("*.png"))
        print(f"\n📦 Loading sprites from {folder}...")
        
        for png_file in png_files:
            emotion = png_file.stem
            print(f"  • {emotion}.png")
            
            img = Image.open(png_file).convert('RGBA')
            
            # Split into 128x128 frames (expecting 512x512 = 4x4 frames)
            frames = []
            for row in range(4):
                for col in range(4):
                    x1 = col * 128
                    y1 = row * 128
                    x2 = x1 + 128
                    y2 = y1 + 128
                    frame = img.crop((x1, y1, x2, y2))
                    frames.append(frame)
            
            self.data["sprites"][emotion] = frames
            self.data["metadata"]["emotions"].append(emotion)
            print(f"    → {len(frames)} frames")
    
    def add_audio(self, folder_path):
        """Add all MP3 audio files from folder WITHOUT compressing them!"""
        folder = Path(folder_path)
        if not folder.exists():
            print(f"❌ Audio folder not found: {folder}")
            return
        
        mp3_files = sorted(folder.glob("*.mp3"))
        print(f"\n🎵 Loading audio from {folder}...")
        
        for mp3_file in mp3_files:
            name = mp3_file.stem
            print(f"  • {name}.mp3")
            
            with open(mp3_file, 'rb') as f:
                audio_data = f.read()
                
                # Проверим, что это действительно MP3
                if len(audio_data) > 10:
                    is_mp3 = (audio_data[:3] == b'ID3') or (audio_data[0] == 0xFF and (audio_data[1] & 0xE0) == 0xE0)
                    if not is_mp3:
                        print(f"    ⚠️ Warning: {name}.mp3 doesn't look like a valid MP3 file!")
                
                # Сохраняем как есть
                self.data["audio"][name] = audio_data
                print(f"    → {len(audio_data)} bytes (stored as-is)")
    
    def add_phrases(self, json_file):
        """Add phrases and metadata from JSON file"""
        if not Path(json_file).exists():
            print(f"❌ Phrases file not found: {json_file}")
            return
        
        print(f"\n📝 Loading data from {json_file}...")
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Обновляем метаданные из JSON
        if "name" in data:
            self.data["metadata"]["name"] = data["name"]
        if "author" in data:
            self.data["metadata"]["author"] = data["author"]
        if "version" in data:
            self.data["metadata"]["version"] = data["version"]
        if "color" in data:
            self.data["metadata"]["color"] = data["color"]
        if "bgcolor" in data:
            self.data["metadata"]["bgcolor"] = data["bgcolor"]
        
        # Загружаем фразы (если есть)
        if "phrases" in data:
            self.data["metadata"]["phrases"] = data["phrases"]
            total = sum(len(v) for v in data["phrases"].values())
            print(f"  • {total} phrases loaded")
        else:
            print(f"  ⚠️ No phrases found in JSON")
    
    def pack(self, output_file="diana.lib"):
        """Pack everything into a single .diana file"""
        print(f"\n📦 Packing to {output_file}...")
        
        with open(output_file, 'wb') as f:
            # Write header
            f.write(self.version.encode())
            
            # Write metadata (compressed JSON)
            meta_json = json.dumps(self.data["metadata"], indent=2, ensure_ascii=False).encode('utf-8')
            compressed_meta = zlib.compress(meta_json, level=9)
            f.write(struct.pack('I', len(compressed_meta)))
            f.write(compressed_meta)
            print(f"  • Metadata: {len(meta_json)} -> {len(compressed_meta)} bytes")
            print(f"    Name: {self.data['metadata']['name']}")
            print(f"    Author: {self.data['metadata']['author']}")
            print(f"    Colors: {self.data['metadata']['color']} / {self.data['metadata']['bgcolor']}")
            
            # Write sprites (сжимаем спрайты)
            sprite_count = 0
            for emotion, frames in self.data["sprites"].items():
                for frame in frames:
                    # Получаем байты изображения напрямую из PIL
                    img_bytes = frame.tobytes()
                    compressed = zlib.compress(img_bytes, level=9)
                    f.write(struct.pack('I', len(compressed)))
                    f.write(compressed)
                    sprite_count += 1
            print(f"  • Sprites: {sprite_count} frames (compressed)")
            
            # Write audio (НЕ СЖАТЫЕ!)
            audio_count = 0
            for name, audio_data in sorted(self.data["audio"].items()):
                name_bytes = name.encode('utf-8')
                f.write(struct.pack('I', len(name_bytes)))
                f.write(name_bytes)
                f.write(struct.pack('I', len(audio_data)))
                f.write(audio_data)
                audio_count += 1
            print(f"  • Audio: {audio_count} files (uncompressed)")
            
            # Write end marker
            f.write(b"DIANA_END")
        
        # Проверим размер
        file_size = Path(output_file).stat().st_size
        print(f"\n✅ Successfully packed to {output_file}")
        print(f"📊 Summary:")
        print(f"  • Name: {self.data['metadata']['name']}")
        print(f"  • Emotions: {len(self.data['metadata']['emotions'])}")
        print(f"  • Frames per emotion: {self.data['metadata']['frame_count']}")
        print(f"  • Audio files: {len(self.data['audio'])}")
        print(f"  • Total size: {file_size} bytes")
        
        # Финальная проверка
        audio_size = sum(len(d) for d in self.data['audio'].values())
        print(f"  • Audio data: {audio_size} bytes")

def main():
    """Main packing routine"""
    packer = DianaPacker()
    
    # Default folders (adjust as needed)
    sprites_folder = "./sprites"
    audio_folder = "./audio"
    phrases_file = "./phrases.json"
    output_file = "./diana.lib"
    
    # Check if folders exist
    if not Path(sprites_folder).exists():
        print(f"Creating {sprites_folder} directory...")
        Path(sprites_folder).mkdir(exist_ok=True)
        print(f"Please add your PNG sprites to {sprites_folder}")
        return
    
    if not Path(audio_folder).exists():
        print(f"Creating {audio_folder} directory...")
        Path(audio_folder).mkdir(exist_ok=True)
        print(f"Please add your MP3 files to {audio_folder}")
        return
    
    # Create sample phrases.json if it doesn't exist
    if not Path(phrases_file).exists():
        sample_phrases = {
            "name": "Diana",
            "author": "Your Name",
            "version": "1.0.0",
            "color": "#9b59b6",
            "bgcolor": "#4a2a5a",
            "phrases": {
                "greeting": [
                    "Hello again, let's create something beautiful.",
                    "Diana is here. Ready when you are."
                ],
                "start": [
                    "Generating... this might be good.",
                    "Here we go!"
                ],
                "complete": [
                    "Done! Take a look.",
                    "Finished. I hope you like it."
                ],
                "error": [
                    "Oops. Something went wrong.",
                    "Error... maybe clean the queue?"
                ],
                "waiting": [
                    "Still working... patience, my friend.",
                    "Good things take time."
                ]
            }
        }
        with open(phrases_file, 'w', encoding='utf-8') as f:
            json.dump(sample_phrases, f, indent=2, ensure_ascii=False)
        print(f"Created sample {phrases_file}")
        return
    
    # Load everything
    packer.add_sprites(sprites_folder)
    packer.add_audio(audio_folder)
    packer.add_phrases(phrases_file)
    
    # Pack
    packer.pack(output_file)
    
    print(f"\n✨ Done! Copy {output_file} to your ComfyUI-Diana/libraries/ folder.")

if __name__ == "__main__":
    main()