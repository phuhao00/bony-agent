#!/usr/bin/env python3
"""
Generate app icon (.icns), tray PNGs, and brand-logo from electron/assets/logo.png.
Requires Pillow (auto-installed if missing).
"""
import os
import struct
import subprocess
import sys
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'resources', 'icons')
ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
WEB_PUBLIC = os.path.join(ROOT, 'web', 'public')
WEB_STANDALONE_PUBLIC = os.path.join(
    os.path.dirname(__file__), '..', 'resources', 'web-standalone', 'public'
)
LOGO_PATH = os.path.join(ASSETS, 'logo.png')
os.makedirs(OUT, exist_ok=True)
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(WEB_PUBLIC, exist_ok=True)


def ensure_pillow():
    try:
        from PIL import Image  # noqa: F401
        return
    except ImportError:
        print('  installing Pillow…')
        subprocess.check_call(
            [sys.executable, '-m', 'pip', 'install', 'pillow', '--quiet'],
        )


def write_brand_logo(src_path):
    """Sidebar/login use /brand-logo.png — copy directly from electron/assets/logo.png."""
    import shutil
    brand = os.path.join(WEB_PUBLIC, 'brand-logo.png')
    shutil.copy2(src_path, brand)
    print(f'  created {brand} (copy of {src_path})')
    if os.path.isdir(os.path.dirname(WEB_STANDALONE_PUBLIC)):
        os.makedirs(WEB_STANDALONE_PUBLIC, exist_ok=True)
        shutil.copy2(src_path, os.path.join(WEB_STANDALONE_PUBLIC, 'brand-logo.png'))
        print(f'  created {WEB_STANDALONE_PUBLIC}/brand-logo.png')


def fit_square(logo_img, size):
    """Fit logo into a square canvas without stretching (letterbox)."""
    from PIL import Image

    logo = logo_img.convert('RGBA')
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    fitted = logo.copy()
    fitted.thumbnail((size, size), Image.LANCZOS)
    ox = (size - fitted.width) // 2
    oy = (size - fitted.height) // 2
    canvas.paste(fitted, (ox, oy), fitted)
    return canvas


def load_logo_image():
    from PIL import Image, ImageDraw

    if not os.path.exists(LOGO_PATH):
        img = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle([40, 40, 472, 472], radius=96, fill=(108, 99, 255, 255))
        draw.polygon([(256, 100), (340, 380), (256, 320), (172, 380)], fill=(255, 255, 255, 240))
        img.save(LOGO_PATH)
        print(f'  warning: {LOGO_PATH} missing — generated placeholder (add your logo.png)')
    return Image.open(LOGO_PATH).convert('RGBA')


def build_with_pillow():
    from PIL import Image, ImageDraw

    if not os.path.exists(LOGO_PATH):
        load_logo_image()
    else:
        print(f'  using {LOGO_PATH}')

    logo = Image.open(LOGO_PATH).convert('RGBA')

    # UI brand logo = exact source file (coconut illustration)
    write_brand_logo(LOGO_PATH)

    icon512 = os.path.join(OUT, 'icon_512.png')
    fit_square(logo, 512).save(icon512)
    print(f'  created {icon512}')

    ico_path = os.path.join(OUT, 'icon.ico')
    ico_sizes = [256, 128, 64, 48, 32, 16]
    ico_images = [fit_square(logo, s) for s in ico_sizes]
    ico_images[0].save(ico_path, format='ICO', append_images=ico_images[1:])
    print(f'  created {ico_path}')

    iconset = os.path.join(OUT, 'icon.iconset')
    if os.path.isdir(iconset):
        import shutil
        shutil.rmtree(iconset)
    os.makedirs(iconset, exist_ok=True)
    for s in [16, 32, 128, 256, 512]:
        fit_square(logo, s).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
        fit_square(logo, s * 2).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))

    icns = os.path.join(OUT, 'icon.icns')
    try:
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
        print(f'  created {icns}')
    except Exception as e:
        import shutil
        shutil.copy(icon512, icns)
        print(f'  warning: iconutil failed ({e}), copied PNG as icns')

    for color, name in [((34, 197, 94), 'tray-green'), ((234, 179, 8), 'tray-yellow'), ((239, 68, 68), 'tray-red')]:
        ti = Image.new('RGBA', (44, 44), (0, 0, 0, 0))
        td = ImageDraw.Draw(ti)
        td.ellipse([4, 4, 40, 40], fill=(*color, 255))
        td.ellipse([4, 4, 40, 40], outline=(255, 255, 255, 200), width=3)
        path = os.path.join(OUT, f'{name}.png')
        ti.save(path)
        ti.resize((22, 22), Image.LANCZOS).save(os.path.join(OUT, f'{name}@1x.png'))
        print(f'  created {path}')


# ── Pure-Python fallback (no Pillow) — still uses logo.png when present ───────

def make_png(size, pixels):
    def chunk(tag, data):
        c = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)

    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    raw = b''
    for y in range(size):
        row = b'\x00'
        for x in range(size):
            c = pixels(x, y)
            if len(c) == 3:
                row += bytes([*c, 255])
            else:
                row += bytes(c)
        raw += row
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend


def draw_app_icon(size):
    cx = cy = size / 2
    r = size * 0.42

    def pixel(x, y):
        dx, dy = x - cx, y - cy
        if abs(dx) > r or abs(dy) > r:
            return (0, 0, 0, 0)
        nx, ny = (x - cx) / size + 0.5, (y - cy) / size + 0.5
        if 0.38 <= nx <= 0.62 and 0.28 <= ny <= 0.72:
            return (255, 255, 255, 240)
        if ny < 0.38 and abs(nx - 0.5) < (0.38 - ny) * 0.55:
            return (255, 255, 255, 240)
        t = y / size
        return (int(90 + 18 * t), int(70 + 22 * t), int(230 - 20 * t), 255)

    return make_png(size, pixel)


def draw_tray_icon(size, rgb):
    cx = cy = (size - 1) / 2
    outer = size * 0.48
    inner = size * 0.38

    def pixel(x, y):
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
        if d <= inner:
            return (*rgb, 255)
        if d <= outer:
            return (255, 255, 255, 220)
        return (0, 0, 0, 0)

    return make_png(size, pixel)


def build_fallback():
    if os.path.exists(LOGO_PATH):
        write_brand_logo(LOGO_PATH)
        if sys.platform == 'darwin':
            icon512 = os.path.join(OUT, 'icon_512.png')
            subprocess.run(['sips', '-z', '512', '512', LOGO_PATH, '--out', icon512], check=True)
            print(f'  created {icon512} (sips from logo.png)')
            iconset = os.path.join(OUT, 'icon.iconset')
            import shutil
            if os.path.isdir(iconset):
                shutil.rmtree(iconset)
            os.makedirs(iconset, exist_ok=True)
            for s in [16, 32, 128, 256, 512]:
                for name, dim in [(f'icon_{s}x{s}.png', s), (f'icon_{s}x{s}@2x.png', s * 2)]:
                    dst = os.path.join(iconset, name)
                    subprocess.run(['sips', '-z', str(dim), str(dim), LOGO_PATH, '--out', dst], check=True)
            icns = os.path.join(OUT, 'icon.icns')
            try:
                subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
                print(f'  created {icns}')
            except Exception as e:
                import shutil
                shutil.copy(icon512, icns)
                print(f'  warning: iconutil failed ({e}), copied PNG as icns')
            for name, rgb in [('tray-green', (34, 197, 94)), ('tray-yellow', (234, 179, 8)), ('tray-red', (239, 68, 68))]:
                path = os.path.join(OUT, f'{name}.png')
                with open(path, 'wb') as f:
                    f.write(draw_tray_icon(44, rgb))
                print(f'  created {path}')
            return

    icon512 = os.path.join(OUT, 'icon_512.png')
    icon_bytes = draw_app_icon(512)
    with open(icon512, 'wb') as f:
        f.write(icon_bytes)
    print(f'  created {icon512} (placeholder — add electron/assets/logo.png)')

    write_brand_logo(icon512)

    for name, rgb in [('tray-green', (34, 197, 94)), ('tray-yellow', (234, 179, 8)), ('tray-red', (239, 68, 68))]:
        path = os.path.join(OUT, f'{name}.png')
        with open(path, 'wb') as f:
            f.write(draw_tray_icon(44, rgb))
        print(f'  created {path}')

    icns = os.path.join(OUT, 'icon.icns')
    try:
        iconset = os.path.join(OUT, 'icon.iconset')
        os.makedirs(iconset, exist_ok=True)
        for s in [16, 32, 128, 256, 512]:
            png = draw_app_icon(s)
            with open(os.path.join(iconset, f'icon_{s}x{s}.png'), 'wb') as f:
                f.write(png)
            with open(os.path.join(iconset, f'icon_{s}x{s}@2x.png'), 'wb') as f:
                f.write(draw_app_icon(s * 2))
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
        print(f'  created {icns}')
    except Exception as e:
        import shutil
        shutil.copy(icon512, icns)
        print(f'  warning: iconutil failed ({e}), copied PNG as icns')


if __name__ == '__main__':
    try:
        ensure_pillow()
        build_with_pillow()
    except Exception as e:
        print(f'  warning: Pillow build failed ({e}), trying fallback…')
        build_fallback()
