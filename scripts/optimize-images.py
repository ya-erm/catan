"""Build display-sized WebP assets while keeping the original artwork untouched.

Run with: python3 scripts/optimize-images.py
Requires Pillow with WebP support. Sizes are capped at four times the largest
size used by the game UI (SVG board units or CSS pixels).
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
OUT = ASSETS / 'optimized'


def write(image, destination, size, quality=84, output_root=OUT):
    image = image.copy()
    image.thumbnail(size, Image.Resampling.LANCZOS)
    destination = output_root / destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, 'WEBP', quality=quality, method=6)
    print(f'{destination.relative_to(ROOT)}  {image.width}×{image.height}  {destination.stat().st_size // 1024} KiB')


with Image.open(ASSETS / 'terrain-atlas.png') as atlas:
    for name, column, row in [('wood', 0, 0), ('brick', 0, 1),
                              ('ore', 1, 1), ('desert', 2, 1)]:
        write(atlas.crop((column * 512, row * 512,
                          (column + 1) * 512, (row + 1) * 512)),
              f'terrain/{name}.webp', (512, 512))

# These two fields replaced their atlas versions in the live board.
for name, source in [('sheep', 'sheep-pasture-v3.png'),
                     ('wheat', 'wheat-field-no-buildings.png')]:
    with Image.open(ASSETS / source) as image:
        write(image, f'terrain/{name}.webp', (512, 512))

with Image.open(ASSETS / 'sea-water-v2.png') as image:
    write(image, 'sea-water.webp', (1024, 1024), 82)

for source in sorted((ASSETS / 'beach-variants').glob('*.png')):
    with Image.open(source) as image:
        write(image, f'beach/{source.stem}.webp', (1024, 1024), 82)

for name in ('wood', 'brick', 'wheat', 'sheep', 'ore'):
    with Image.open(ASSETS / 'icons' / f'{name}.webp') as image:
        write(image, f'icons/{name}.webp', (200, 200), 88)

for name in ('achievement-road-realistic', 'achievement-army-riders'):
    with Image.open(ASSETS / 'icons' / f'{name}.png') as image:
        write(image, f'icons/{name}.webp', (720, 720), 86)

for source in sorted((ASSETS / 'pieces').glob('*.webp')):
    size = (376, 376) if source.stem.startswith('road-') else (
        (200, 200) if source.stem.startswith('settlement-') else (224, 224))
    with Image.open(source) as image:
        write(image, f'pieces/{source.name}', size, 86)

for source in sorted((ASSETS / 'pieces').glob('harbor-pier-*.png')):
    if source.stem == 'harbor-pier-v1':
        continue  # Earlier unused artwork stays available as a source.
    with Image.open(source) as image:
        write(image, f'pieces/{source.stem}.webp', (288, 288), 86)

with Image.open(ASSETS / 'pieces' / 'harbor-sailboat-v2.png') as image:
    write(image, 'pieces/harbor-sailboat-v2.webp', (288, 264), 86)

with Image.open(ASSETS / 'pieces' / 'robber-06.png') as image:
    write(image, 'pieces/robber-06.webp', (152, 212), 86)
