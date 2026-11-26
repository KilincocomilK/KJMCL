"""Build the desktop and NSIS icons from the atlas artwork. Requires Pillow."""

from pathlib import Path
from shutil import copyfile

from PIL import Image

project = Path(__file__).resolve().parents[1]
build = project / "build"
source = project / "resources/icons/KJMCL_icon.png"
copyfile(source, build / "icon.png")

with Image.open(source) as artwork:
    icon = artwork.convert("RGBA")

sizes = [(edge, edge) for edge in (16, 24, 32, 48, 64, 128, 256)]
frames = [icon.resize(size, Image.Resampling.NEAREST) for size in sizes]
icon.save(build / "icon.ico", sizes=sizes, append_images=frames)

# The NSIS illustrations have a dedicated dark tile for the application mark.
for filename, x, y, edge in (
    ("installerHeader.bmp", 102, 8, 40),
    ("installerSidebar.bmp", 46, 68, 72),
):
    with Image.open(build / filename) as original:
        illustration = original.convert("RGB")
    mark = icon.resize((edge, edge), Image.Resampling.NEAREST)
    illustration.paste("#141613", (x, y, x + edge, y + edge))
    illustration.paste(mark, (x, y), mark.getchannel("A"))
    illustration.save(build / filename)
