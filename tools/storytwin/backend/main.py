#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
幼儿英文故事音频生成器 - FastAPI 后端
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import asyncio
import edge_tts
from pathlib import Path
import subprocess
import uuid
import json

app = FastAPI(
    title="StoryTwin - 幼儿英文故事音频生成器",
    description="输入经典故事名称，生成适合 2-6 岁幼儿的中英对照音频 | StoryTwin helps kids learn English through classic stories",
    version="1.0.0"
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 输出目录
OUTPUT_DIR = Path("/tmp/toddler-audio-output")
OUTPUT_DIR.mkdir(exist_ok=True)

# 故事库
STORIES_DB = {
    "wolf": {
        "id": "wolf",
        "name_cn": "狼来了",
        "name_en": "The Boy Who Cried Wolf",
        "description": "经典寓言故事，教育孩子不要说谎",
        "duration": "约 5 分钟",
        "sentences": [
            ("从前，有个放羊娃。", "Once upon a time, there was a shepherd's boy."),
            ("他住在小村庄里。", "He lived in a small village."),
            ("他有一群小羊。", "He had a flock of sheep."),
            ("每天，他去山上放羊。", "Every day, he took the sheep to the hill."),
            ("小羊吃草。", "The sheep ate grass."),
            ("小羊咩咩叫。", "The sheep said baaa... baaa..."),
            ("放羊娃坐在草地上。", "The boy sat on the grass."),
            ("他看看四周。", "He looked around."),
            ("只有小羊陪他。", "Only the sheep were with him."),
            ("他觉得好无聊。", "He felt very bored."),
            ("他想找点乐子。", "He wanted to have some fun."),
            ("他想了个主意。", "He had an idea."),
            ("放羊娃站起来。", "The boy stood up."),
            ("他向山下大喊。", "He shouted down the hill."),
            ("狼来了！狼来了！救命啊！", "Wolf! Wolf! Help! Help!"),
            ("山下有农夫们在种田。", "Down the hill, farmers were working."),
            ("农夫们听到了。", "The farmers heard him."),
            ("他们很担心。", "They were worried."),
            ("他们拿着锄头和镰刀。", "They took their hoes and sickles."),
            ("他们跑上山。", "They ran up the hill."),
            ("不要怕，孩子！", "Do not be afraid, child!"),
            ("我们来帮你打恶狼！", "We will help you fight the wolf!"),
            ("放羊娃哈哈大笑。", "The boy laughed loudly."),
            ("哈哈！哈哈！哈哈！", "Haha! Haha! Haha!"),
            ("没有狼！", "There is no wolf!"),
            ("我骗你们的！", "I was joking!"),
            ("你们上当了！", "You were fooled!"),
            ("农夫们很生气。", "The farmers were very angry."),
            ("他们下山了。", "They went down the hill."),
            ("第二天，放羊娃又去放羊。", "Next day, the boy took the sheep again."),
            ("他又觉得无聊。", "He felt bored again."),
            ("他又想了个主意。", "He had another idea."),
            ("他又向山下大喊。", "He shouted down the hill again."),
            ("狼来了！狼来了！救命啊！", "Wolf! Wolf! Help! Help!"),
            ("农夫们又听到了。", "The farmers heard him again."),
            ("他们又跑上山。", "They ran up the hill again."),
            ("可是... 没有狼！", "But... there was no wolf!"),
            ("放羊娃又笑了。", "The boy laughed again."),
            ("哈哈！你们又上当了！", "Haha! You were fooled again!"),
            ("农夫们更生气了。", "The farmers were even angrier."),
            ("他们说：不要再说了！", "They said: Do not do it again!"),
            ("他们说：说谎不好！", "They said: Lying is bad!"),
            ("他们下山了。", "They went down the hill."),
            ("过了几天。", "A few days later."),
            ("放羊娃在放羊。", "The boy was watching the sheep."),
            ("突然... 有声音！", "Suddenly... there was a sound!"),
            ("一只大灰狼来了！", "A big gray wolf came!"),
            ("大灰狼有尖尖的牙。", "The wolf had sharp teeth."),
            ("大灰狼有红红的眼睛。", "The wolf had red eyes."),
            ("大灰狼闯进羊群。", "The wolf ran into the sheep."),
            ("放羊娃很害怕。", "The boy was very scared."),
            ("他拼命大喊。", "He shouted as loud as he could."),
            ("狼来了！狼来了！快救命啊！", "Wolf! Wolf! Help! Help quickly!"),
            ("狼真的来了！", "A real wolf is here!"),
            ("快来帮我！", "Please come and help me!"),
            ("农夫们听到了。", "The farmers heard him."),
            ("但是他们想...", "But they thought..."),
            ("他又在说谎。", "He is lying again."),
            ("他们不理睬他。", "They did not pay attention to him."),
            ("没有人去帮他。", "No one went to help him."),
            ("放羊娃继续喊。", "The boy kept shouting."),
            ("但是... 没有人来。", "But... no one came."),
            ("大灰狼咬死了一只羊。", "The wolf killed one sheep."),
            ("又咬死了一只羊。", "It killed another sheep."),
            ("又咬死了一只羊。", "It killed another sheep."),
            ("很多羊都被咬死了。", "Many sheep were killed."),
            ("放羊娃哭了。", "The boy cried."),
            ("他好难过。", "He was very sad."),
            ("放羊娃明白了。", "The boy understood."),
            ("他说：对不起。", "He said: I am sorry."),
            ("我不应该说谎。", "I should not have lied."),
            ("农夫们说：没关系。", "The farmers said: It is okay."),
            ("但是... 记住这个教训。", "But... remember this lesson."),
            ("说谎的人...", "A liar..."),
            ("就算说真话...", "Even when he tells the truth..."),
            ("也没有人相信。", "No one will believe him."),
            ("要说真话。", "Tell the truth."),
            ("真话很重要。", "Truth is very important."),
            ("故事讲完了。", "The story is over."),
            ("小朋友，要记住哦。", "Little friends, please remember."),
            ("不要说谎。", "Do not lie."),
            ("要说真话。", "Tell the truth."),
            ("做个诚实的好孩子。", "Be an honest good child."),
            ("再见！", "Goodbye!"),
        ]
    }
}

# 声音配置
VOICE_OPTIONS = {
    "cn": [
        {"id": "xiaoyi", "name": "活泼女声", "voice": "zh-CN-XiaoyiNeural"},
        {"id": "xiaoxiao", "name": "温柔女声", "voice": "zh-CN-XiaoxiaoNeural"},
        {"id": "yunjian", "name": "成熟男声", "voice": "zh-CN-YunjianNeural"},
    ],
    "en": [
        {"id": "jenny", "name": "活泼女声", "voice": "en-US-JennyNeural"},
        {"id": "ana", "name": "温柔女声", "voice": "en-US-AnaNeural"},
        {"id": "guy", "name": "阳光男声", "voice": "en-US-GuyNeural"},
    ]
}


class GenerateRequest(BaseModel):
    story_id: str
    cn_voice: str = "zh-CN-XiaoyiNeural"
    en_voice: str = "en-US-JennyNeural"
    cn_rate: str = "-5%"
    en_rate: str = "-10%"
    play_mode: str = "separate"  # "separate" or "alternating"


class StoryInfo(BaseModel):
    id: str
    name_cn: str
    name_en: str
    description: str
    duration: str
    sentence_count: int


@app.get("/")
async def root():
    """API 首页"""
    return {
        "name": "幼儿英文故事音频生成器",
        "version": "1.0.0",
        "endpoints": {
            "stories": "/api/stories",
            "voices": "/api/voices",
            "generate": "/api/generate",
            "download": "/api/download/{task_id}"
        }
    }


@app.get("/api/stories", response_model=List[StoryInfo])
async def get_stories():
    """获取所有故事列表"""
    return [
        StoryInfo(
            id=s["id"],
            name_cn=s["name_cn"],
            name_en=s["name_en"],
            description=s["description"],
            duration=s["duration"],
            sentence_count=len(s["sentences"])
        )
        for s in STORIES_DB.values()
    ]


@app.get("/api/stories/{story_id}")
async def get_story(story_id: str):
    """获取单个故事详情"""
    if story_id not in STORIES_DB:
        raise HTTPException(status_code=404, detail="故事不存在")
    
    story = STORIES_DB[story_id]
    return {
        "id": story["id"],
        "name_cn": story["name_cn"],
        "name_en": story["name_en"],
        "description": story["description"],
        "duration": story["duration"],
        "sentence_count": len(story["sentences"]),
        "preview": story["sentences"][:5]  # 预览前 5 句
    }


@app.get("/api/voices")
async def get_voices():
    """获取所有声音选项"""
    return VOICE_OPTIONS


@app.post("/api/generate")
async def generate_audio(request: GenerateRequest):
    """生成音频"""
    if request.story_id not in STORIES_DB:
        raise HTTPException(status_code=404, detail="故事不存在")
    
    story = STORIES_DB[request.story_id]
    task_id = str(uuid.uuid4())[:8]
    output_dir = OUTPUT_DIR / task_id
    output_dir.mkdir(exist_ok=True)
    
    # 异步生成任务
    asyncio.create_task(
        generate_audio_task(
            task_id=task_id,
            story=story,
            cn_voice=request.cn_voice,
            en_voice=request.en_voice,
            cn_rate=request.cn_rate,
            en_rate=request.en_rate,
            play_mode=request.play_mode
        )
    )
    
    return {
        "task_id": task_id,
        "status": "processing",
        "story_name": story["name_cn"],
        "estimated_time": len(story["sentences"]) * 2  # 估算秒数
    }


async def generate_audio_task(task_id: str, story: dict, cn_voice: str, en_voice: str, 
                              cn_rate: str, en_rate: str, play_mode: str):
    """音频生成任务"""
    output_dir = OUTPUT_DIR / task_id
    status_file = output_dir / "status.json"
    
    try:
        # 更新状态
        with open(status_file, "w") as f:
            json.dump({"status": "processing", "progress": 0}, f)
        
        cn_files = []
        en_files = []
        sentences = story["sentences"]
        
        # 生成中文
        for i, (cn, en) in enumerate(sentences, 1):
            cn_file = output_dir / f"cn_{i:03d}.mp3"
            communicate = edge_tts.Communicate(cn, cn_voice, rate=cn_rate)
            await communicate.save(cn_file)
            cn_files.append(cn_file)
            
            # 更新进度
            with open(status_file, "w") as f:
                json.dump({
                    "status": "processing",
                    "progress": int((i / len(sentences)) * 50)
                }, f)
        
        # 生成英文
        for i, (cn, en) in enumerate(sentences, 1):
            en_file = output_dir / f"en_{i:03d}.mp3"
            communicate = edge_tts.Communicate(en, en_voice, rate=en_rate)
            await communicate.save(en_file)
            en_files.append(en_file)
            
            # 更新进度
            with open(status_file, "w") as f:
                json.dump({
                    "status": "processing",
                    "progress": 50 + int((i / len(sentences)) * 50)
                }, f)
        
        # 合并音频
        if play_mode == "separate":
            # 先中文后英文
            list_file = output_dir / "files.txt"
            with open(list_file, "w") as f:
                for audio_file in cn_files:
                    f.write(f"file '{audio_file}'\n")
                # 3 秒停顿
                silence_file = output_dir / "pause.mp3"
                cmd_silence = [
                    "ffmpeg", "-y",
                    "-f", "lavfi",
                    "-i", "anullsrc=r=44100:cl=mono",
                    "-t", "3",
                    "-b:a", "192k",
                    str(silence_file)
                ]
                subprocess.run(cmd_silence, capture_output=True)
                f.write(f"file '{silence_file}'\n")
                for audio_file in en_files:
                    f.write(f"file '{audio_file}'\n")
            
            final_output = output_dir / "final.mp3"
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(list_file),
                "-c", "copy",
                "-b:a", "192k",
                str(final_output)
            ]
            subprocess.run(cmd, capture_output=True)
        else:
            # 中英交替
            list_file = output_dir / "files.txt"
            with open(list_file, "w") as f:
                for cn_file, en_file in zip(cn_files, en_files):
                    f.write(f"file '{cn_file}'\n")
                    f.write(f"file '{en_file}'\n")
            
            final_output = output_dir / "final.mp3"
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(list_file),
                "-c", "copy",
                "-b:a", "192k",
                str(final_output)
            ]
            subprocess.run(cmd, capture_output=True)
        
        # 清理临时文件
        for f in cn_files + en_files:
            f.unlink(missing_ok=True)
        
        # 更新状态为完成
        with open(status_file, "w") as f:
            json.dump({
                "status": "completed",
                "progress": 100,
                "file_size": final_output.stat().st_size
            }, f)
            
    except Exception as e:
        with open(status_file, "w") as f:
            json.dump({"status": "failed", "error": str(e)}, f)


@app.get("/api/status/{task_id}")
async def get_status(task_id: str):
    """获取任务状态"""
    status_file = OUTPUT_DIR / task_id / "status.json"
    if not status_file.exists():
        raise HTTPException(status_code=404, detail="任务不存在")
    
    with open(status_file, "r") as f:
        return json.load(f)


@app.get("/api/download/{task_id}")
async def download_audio(task_id: str):
    """下载音频"""
    audio_file = OUTPUT_DIR / task_id / "final.mp3"
    if not audio_file.exists():
        raise HTTPException(status_code=404, detail="音频文件不存在")
    
    return FileResponse(
        audio_file,
        media_type="audio/mpeg",
        filename=f"story_{task_id}.mp3"
    )


# 挂载静态文件目录（前端）
frontend_dir = Path(__file__).parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get('PORT', 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
