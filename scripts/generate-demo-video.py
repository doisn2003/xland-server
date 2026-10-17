"""Generate synthetic XLand MP4 without third-party images/footage.
Set FFMPEG_BIN to a local ffmpeg executable. Does not install/change machine tools.
"""
import os, pathlib, subprocess, json, hashlib
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'demo-assets'/'w4'
out.mkdir(parents=True,exist_ok=True)
ffmpeg=os.environ['FFMPEG_BIN']
font=pathlib.Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/'arial.ttf'
# FFmpeg Windows filter escaping, no user supplied text or property information.
fontarg=str(font).replace('\\','/').replace(':','\\:')
filtergraph=(f"color=c=0x183c34:s=360x640:r=24:d=4,"
 f"drawtext=fontfile='{fontarg}':text='XLAND DEMO ONLY':fontcolor=white:fontsize=28:x=(w-tw)/2:y=120,"
 f"drawtext=fontfile='{fontarg}':text='SYNTHETIC - NO REAL LAND':fontcolor=white:fontsize=17:x=(w-tw)/2:y=175,"
 "drawbox=x=50:y=300:w=260:h=100:color=0xd4ab61:t=fill,"
 f"drawtext=fontfile='{fontarg}':text='PROJECT GENERATED':fontcolor=0x183c34:fontsize=18:x=(w-tw)/2:y=340")
command=[ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',filtergraph,'-an','-c:v','libx264','-profile:v','baseline','-level:v','3.0','-pix_fmt','yuv420p','-movflags','+faststart','-metadata','title=XLAND DEMO ONLY - Synthetic project media',str(out/'xland-synthetic.mp4')]
subprocess.run(command,check=True,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
subprocess.run([ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-y','-i',str(out/'xland-synthetic.mp4'),'-frames:v','1',str(out/'xland-synthetic.png')],check=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
files=[]
for name,mime in [('xland-synthetic.mp4','video/mp4'),('xland-synthetic.png','image/png')]:
 data=(out/name).read_bytes();files.append(dict(name=name,mimeType=mime,sizeBytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
manifest=dict(mode='synthetic demo only',source='XLand project procedural color/text generator; no external property footage',attribution='Generated for XLand integration tests; Arial rasterized from local Windows font, not redistributed as a font file',legalEvidence=False,video=dict(codec='H264 baseline',pixelFormat='yuv420p',width=360,height=640,fps=24,durationSeconds=4,audio=False,fastStart=True),generator='scripts/generate-demo-video.py',generatorSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),encoder=subprocess.run([ffmpeg,'-version'],capture_output=True,text=True,check=True).stdout.splitlines()[0],files=files)
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(dict(event='synthetic_video_generated',files=files)))
