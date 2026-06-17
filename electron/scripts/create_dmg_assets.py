#!/usr/bin/env python3
"""Generate App Icon (ICNS) + DMG background using the project logo."""

import math, os, subprocess, sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pillow', '--quiet'])
    from PIL import Image, ImageDraw, ImageFont, ImageFilter

SCRIPT_DIR = Path(__file__).parent
ICONS_DIR  = SCRIPT_DIR.parent / 'resources' / 'icons'
ASSETS_DIR = SCRIPT_DIR.parent / 'assets'
LOGO_SRC   = ASSETS_DIR / 'logo.png'
ICONS_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

BG_DARK  = (10,  10,  26)
BG_MID   = (22,  22,  54)
PURPLE   = (108, 92,  231)
TEAL     = (0,   206, 201)
WHITE    = (255, 255, 255)
GRAY     = (160, 160, 190)

# ── PART 1: ICNS ─────────────────────────────────────────────────────────────
def build_icns():
    logo = Image.open(LOGO_SRC).convert('RGBA')
    iconset = ICONS_DIR / 'icon.iconset'
    iconset.mkdir(exist_ok=True)
    for s in [16, 32, 64, 128, 256, 512]:
        logo.resize((s,    s   ), Image.LANCZOS).save(iconset / f'icon_{s}x{s}.png')
        logo.resize((s*2,  s*2 ), Image.LANCZOS).save(iconset / f'icon_{s}x{s}@2x.png')
    logo.resize((512, 512), Image.LANCZOS).save(str(ICONS_DIR / 'icon_512.png'))
    icns = ICONS_DIR / 'icon.icns'
    ret = subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(icns)], capture_output=True)
    print(f'  {"✓" if ret.returncode==0 else "✗"} icon.icns')
    return logo

# ── PART 2: Tray icons ───────────────────────────────────────────────────────
def build_tray_icons():
    for color, name in [((80,220,100),'tray-green'),((255,200,50),'tray-yellow'),((255,80,80),'tray-red')]:
        ti = Image.new('RGBA', (44,44), (0,0,0,0))
        td = ImageDraw.Draw(ti)
        td.ellipse([2,2,42,42], fill=(*color,240))
        td.ellipse([2,2,42,42], outline=(255,255,255,80), width=2)
        ti.resize((22,22), Image.LANCZOS).save(str(ICONS_DIR / f'{name}.png'))
        print(f'  ✓ {name}.png')

# ── PART 3: DMG Background 1080x760 (@2x Retina) ────────────────────────────
def make_dmg_background(logo_img, w=1080, h=760):
    img = Image.new('RGB', (w, h))
    draw = ImageDraw.Draw(img)
    # Gradient bg
    for y in range(h):
        t = y/h
        draw.line([(0,y),(w,y)], fill=tuple(int(BG_DARK[i]+(BG_MID[i]-BG_DARK[i])*t) for i in range(3)))
    # Dot grid
    for x in range(0,w,48):
        for y in range(0,h,48):
            draw.ellipse([x-1,y-1,x+1,y+1], fill=(40,40,80))
    # Glow blobs
    glow = Image.new('RGB',(w,h),(0,0,0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([0,h//2-280,560,h//2+280], fill=(60,30,140))
    gd.ellipse([600,h//2-200,w,h//2+200], fill=(20,60,90))
    glow = glow.filter(ImageFilter.GaussianBlur(100))
    img = Image.blend(img, glow, 0.45)
    draw = ImageDraw.Draw(img)

    def font(path, size):
        try: return ImageFont.truetype(path, size)
        except: return ImageFont.load_default()
    f_title = font('/System/Library/Fonts/Helvetica.ttc', 72)
    f_sub   = font('/System/Library/Fonts/STHeiti Light.ttc', 30)
    f_hint  = font('/System/Library/Fonts/Helvetica.ttc', 30)
    f_small = font('/System/Library/Fonts/Helvetica.ttc', 22)

    # Title
    title = 'AI Media Agent'
    tb = draw.textbbox((0,0), title, font=f_title)
    tw = tb[2]-tb[0]
    for dx,dy in [(-3,-3),(3,-3),(-3,3),(3,3)]:
        draw.text((w//2-tw//2+dx, 64+dy), title, font=f_title, fill=(60,30,140))
    draw.text((w//2-tw//2, 64), title, font=f_title, fill=WHITE)
    # Subtitle
    subtitle = '全链路内容生产与分发数字员工'
    sb = draw.textbbox((0,0), subtitle, font=f_sub)
    sw = sb[2]-sb[0]
    draw.text((w//2-sw//2, 152), subtitle, font=f_sub, fill=(*GRAY,210))
    # Separator
    for i in range(w//4, 3*w//4):
        a = int(120*math.sin(math.pi*(i-w//4)/(w//2)))
        draw.point((i,200), fill=(*PURPLE,a))

    # Logo left (DMG icon pos @2x: file centre 280,390)
    lx, ly, ls = 280, 390, 180
    logo_r = logo_img.resize((ls,ls), Image.LANCZOS).convert('RGBA')
    # Shadow
    shd = Image.new('RGBA',(ls+40,ls+40),(0,0,0,0))
    ImageDraw.Draw(shd).rounded_rectangle([20,20,ls+20,ls+20], radius=ls//5, fill=(0,0,0,180))
    shd = shd.filter(ImageFilter.GaussianBlur(16))
    img.paste(shd, (lx-ls//2-20, ly-ls//2-10), shd)
    img.paste(logo_r, (lx-ls//2, ly-ls//2), logo_r)
    al = 'AI Media Agent.app'
    alb = draw.textbbox((0,0), al, font=f_small); alw = alb[2]-alb[0]
    draw.text((lx-alw//2, ly+ls//2+14), al, font=f_small, fill=GRAY)

    # Gradient arrow
    rx, ry = 800, 390
    ax0 = lx+ls//2+20; ax1 = rx-100
    for i in range(ax1-ax0):
        t = i/(ax1-ax0)
        c = tuple(int(PURPLE[j]+(TEAL[j]-PURPLE[j])*t) for j in range(3))
        draw.line([(ax0+i,ry-3),(ax0+i,ry+3)], fill=(*c,200))
    draw.polygon([(ax1+50,ry),(ax1,ry-26),(ax1,ry+26)], fill=(*TEAL,220))

    # Folder icon (right)
    fw,fh = 160,130; fx0=rx-fw//2; fy0=ry-fh//2
    draw.rounded_rectangle([fx0,fy0+18,fx0+fw,fy0+fh], radius=12, fill=(0,95,204))
    draw.rounded_rectangle([fx0,fy0,fx0+60,fy0+26], radius=8, fill=(0,95,204))
    draw.rounded_rectangle([fx0,fy0+15,fx0+fw,fy0+fh], radius=12, fill=(10,132,255))
    draw.rectangle([fx0+10,fy0+20,fx0+fw-10,fy0+26], fill=(90,180,255))
    fl = 'Applications'
    flb = draw.textbbox((0,0),fl,font=f_small); flw=flb[2]-flb[0]
    draw.text((rx-flw//2, fy0+fh+14), fl, font=f_small, fill=GRAY)

    # Drag hint
    hint='Drag to install'
    hb=draw.textbbox((0,0),hint,font=f_hint); hw=hb[2]-hb[0]
    draw.text((w//2-hw//2,570), hint, font=f_hint, fill=(*GRAY,170))
    # Version badge
    ver='v 1.0.0'
    vb=draw.textbbox((0,0),ver,font=f_small); vw=vb[2]-vb[0]
    bx=w//2-vw//2-16
    draw.rounded_rectangle([bx,630,bx+vw+32,660], radius=14, fill=(*PURPLE,70))
    draw.text((bx+16,632), ver, font=f_small, fill=(*TEAL,220))
    # Bottom line
    draw.rectangle([0,h-2,w,h], fill=(*PURPLE,80))
    return img

if __name__ == '__main__':
    if not LOGO_SRC.exists():
        print(f'ERROR: {LOGO_SRC} not found'); sys.exit(1)
    print('▶ Generating ICNS...')
    logo = build_icns()
    print('▶ Generating tray icons...')
    build_tray_icons()
    print('▶ Generating DMG background...')
    bg = make_dmg_background(logo)
    bg.save(str(ASSETS_DIR / 'dmg-background.png'))
    print(f'  ✓ dmg-background.png (1080×760)')
    print('Done!')
