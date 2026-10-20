"""生成启动器图标（多尺寸 ico），仅用 Pillow。"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'build')
os.makedirs(OUT, exist_ok=True)

SIZE = 256
SS = 4  # 超采样，边缘更干净
img = Image.new('RGBA', (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

pad = 10 * SS
radius = 58 * SS
# 底板：绿色到深绿的竖向渐变（逐行绘制）
top = (32, 200, 122)
bottom = (14, 138, 82)
grad = Image.new('RGBA', (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(SIZE * SS):
    t = y / (SIZE * SS - 1)
    gd.line(
        [(0, y), (SIZE * SS, y)],
        fill=(int(top[0] + (bottom[0] - top[0]) * t),
              int(top[1] + (bottom[1] - top[1]) * t),
              int(top[2] + (bottom[2] - top[2]) * t), 255),
    )
mask = Image.new('L', (SIZE * SS, SIZE * SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, SIZE * SS - pad, SIZE * SS - pad], radius=radius, fill=255)
img = Image.composite(grad, img, mask)
d = ImageDraw.Draw(img)

font = None
for cand, size in [
    ('C:/Windows/Fonts/arialbd.ttf', 118),
    ('C:/Windows/Fonts/seguisb.ttf', 112),
    ('C:/Windows/Fonts/msyhbd.ttc', 104),
]:
    try:
        font = ImageFont.truetype(cand, size * SS)
        break
    except Exception:
        continue
if font is None:
    font = ImageFont.load_default()

# 白字居中，轻微下移一点视觉更稳
d.text((SIZE * SS / 2, SIZE * SS / 2 + 2 * SS), 'MC', font=font, fill=(255, 255, 255, 255), anchor='mm')

img = img.resize((SIZE, SIZE), Image.LANCZOS)

png_path = os.path.join(OUT, 'icon.png')
img.save(png_path, 'PNG')
ico_path = os.path.join(OUT, 'icon.ico')
img.save(ico_path, 'ICO', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('wrote', png_path)
print('wrote', ico_path, os.path.getsize(ico_path), 'bytes')
