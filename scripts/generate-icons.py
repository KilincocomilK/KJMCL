"""Generate the original geometric KJMCL mark. Requires Pillow; icons are committed."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent.parent / 'build'
root.mkdir(exist_ok=True)
im = Image.new('RGBA', (512,512), '#141613')
d = ImageDraw.Draw(im)
points = [(90,90),(190,90),(190,227),(330,90),(445,90),(282,256),(445,422),(315,422),(190,295),(190,422),(90,422)]
d.polygon(points, fill='#f26b21')
im.save(root/'icon.png')
im.save(root/'icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
