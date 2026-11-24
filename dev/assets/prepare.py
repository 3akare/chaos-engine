"""Build src/client/assets from Kenney's CC0 packs (New Platformer Pack, Game Icons).

Usage: python3 dev/assets/prepare.py /path/to/kenney   (folder holding the unzipped packs)
Copies the sprites the game uses and derives a few (ball, build spot, red side spring).
"""
import shutil, sys
from pathlib import Path
from PIL import Image, ImageDraw

src = Path(sys.argv[1])
out = Path(__file__).resolve().parents[2] / 'src/client/assets'
(out / 'icons').mkdir(parents=True, exist_ok=True)
tiles = src / 'new-platformer-pack/Sprites/Tiles/Double'
bgs = src / 'new-platformer-pack/Sprites/Backgrounds/Double'
INK = (53, 53, 65, 255)

copy = {
    # walls (grass terrain, auto-tiled by neighbours)
    **{f'wall_{k}': f'terrain_grass_{k}' for k in [
        'block', 'block_top', 'block_top_left', 'block_top_right', 'block_left', 'block_right', 'block_center',
        'block_bottom', 'block_bottom_left', 'block_bottom_right',
        'horizontal_left', 'horizontal_middle', 'horizontal_right',
        'vertical_top', 'vertical_middle', 'vertical_bottom']},
    'ramp': 'ramp', 'spring': 'spring', 'spring_out': 'spring_out',
    'flag_a': 'flag_green_a', 'flag_b': 'flag_green_b',
    'switch': 'switch_yellow', 'switch_on': 'switch_yellow_pressed', 'lock': 'lock_yellow',
    'coin': 'coin_gold', 'star': 'star',
}
for k, v in copy.items():
    shutil.copy(tiles / f'{v}.png', out / f'{k}.png')
for k in ['background_clouds', 'background_fade_hills', 'background_solid_sky']:
    shutil.copy(bgs / f'{k}.png', out / f'{k.replace("background_", "bg_")}.png')

# Bumper: the spring with its blue pad recoloured red (it kicks the ball sideways).
im = Image.open(tiles / 'spring.png').convert('RGBA')
px = im.load()
swap = {(65, 159, 221): (229, 67, 65), (143, 202, 240): (241, 117, 117), (54, 111, 191): (188, 36, 35), (113, 185, 232): (236, 98, 97)}
for y in range(im.height):
    for x in range(im.width):
        r, g, b, a = px[x, y]
        if (r, g, b) in swap:
            px[x, y] = (*swap[(r, g, b)], a)
        elif b > r + 40 and b > 150 and a > 0:  # anti-aliased blues
            px[x, y] = (min(255, b), int(g * 0.5), int(r * 0.8), a)
im.save(out / 'bumper.png')
spring_out = Image.open(tiles / 'spring_out.png').convert('RGBA')
p2 = spring_out.load()
for y in range(spring_out.height):
    for x in range(spring_out.width):
        r, g, b, a = p2[x, y]
        if (r, g, b) in swap:
            p2[x, y] = (*swap[(r, g, b)], a)
        elif b > r + 40 and b > 150 and a > 0:
            p2[x, y] = (min(255, b), int(g * 0.5), int(r * 0.8), a)
spring_out.save(out / 'bumper_out.png')

# Balls: same outline weight and flat shading as the pack, drawn at 4x then reduced.
# Red is the test ball; each surprise ball has its own colour.
S = 512
def ball(name, fill, shade):
    b = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(b)
    d.ellipse((40, 40, S - 40, S - 40), fill=INK)
    d.ellipse((72, 72, S - 72, S - 72), fill=fill + (255,))
    d.pieslice((72, 72, S - 72, S - 72), 20, 200, fill=shade + (255,))
    d.ellipse((92, 80, S - 92, S - 120), fill=fill + (255,))
    d.ellipse((150, 130, 240, 220), fill=(255, 255, 255, 230))
    b.resize((128, 128), Image.LANCZOS).save(out / f'{name}.png')
ball('ball', (229, 67, 65), (188, 36, 35))
ball('ball_blue', (65, 159, 221), (54, 111, 191))
ball('ball_green', (46, 204, 113), (26, 160, 116))
ball('ball_purple', (155, 89, 182), (113, 54, 138))
ball('ball_yellow', (255, 200, 81), (227, 155, 31))
ball('ball_grey', (146, 161, 173), (100, 112, 125))

# Build spot: a soft white tile with a plus, so empty places read as "a piece goes here".
s = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(s)
d.rounded_rectangle((44, 44, S - 44, S - 44), radius=88, fill=(255, 255, 255, 150), outline=(53, 53, 65, 70), width=22)
for w, col in [(64, (53, 53, 65, 80))]:
    d.rounded_rectangle((S // 2 - w // 2, 150, S // 2 + w // 2, S - 150), radius=w // 2, fill=col)
    d.rounded_rectangle((150, S // 2 - w // 2, S - 150, S // 2 + w // 2), radius=w // 2, fill=col)
s.resize((128, 128), Image.LANCZOS).save(out / 'spot.png')

# UI icons (white).
icons = src / 'game-icons/PNG/White/2x'
for k in ['right', 'stop', 'cross', 'checkmark', 'question', 'star', 'trophy', 'arrowLeft', 'arrowRight', 'fastForward', 'return', 'pause', 'trashcan']:
    shutil.copy(icons / f'{k}.png', out / 'icons' / f'{k}.png')
(out / 'LICENSE.md').write_text('Art and icons by Kenney (www.kenney.nl), CC0 1.0 (public domain).\n'
                                'New Platformer Pack, Game Icons. Derived files (ball, spot, bumper) are made by dev/assets/prepare.py; the fan (fan, fan_blades, fan_icon) is drawn in dev/assets/fan.svg.html in the same style.\n')
print('ok', len(list(out.glob('*.png'))), 'sprites')
