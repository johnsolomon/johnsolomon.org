"""Draws the Apple TV app icon (three layers, for the tilt effect when it's selected) and the
Top Shelf banner, and writes the asset catalog Xcode expects.   usage: python3 make_assets.py"""
import json, os, shutil
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "FamilyTV", "Assets.xcassets")
INFO = {"author": "xcode", "version": 1}
RED, WHITE = (229, 56, 59, 255), (245, 245, 247, 255)


def back(w, h):
    """dark vertical gradient, like the website's icon"""
    top, bottom = (38, 38, 44), (11, 11, 13)
    im = Image.new("RGBA", (w, h))
    px = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        px.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    return im


def geometry(w, h, cx=None, s=None):
    """where the TV sits: s = size unit (screen height)"""
    s = s or h * 0.36
    cx = cx if cx is not None else w / 2
    cy = h * 0.53
    bw, bh = s * 1.45, s
    return cx, cy, bw, bh, s


def tv(w, h, **k):
    """white TV outline, antenna and stand"""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, bw, bh, s = geometry(w, h, **k)
    line = max(2, round(s * 0.085))
    d.rounded_rectangle([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], radius=s * 0.16, outline=WHITE, width=line)
    top = cy - bh / 2
    d.line([(cx - s * 0.32, top - s * 0.42), (cx, top - line * 0.2)], fill=WHITE, width=line)
    d.line([(cx + s * 0.32, top - s * 0.42), (cx, top - line * 0.2)], fill=WHITE, width=line)
    y = cy + bh / 2 + s * 0.2
    d.rounded_rectangle([cx - s * 0.38, y, cx + s * 0.38, y + line], radius=line / 2, fill=WHITE)
    return im


def play(w, h, **k):
    """the red play button, on its own layer so it floats in front"""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, bw, bh, s = geometry(w, h, **k)
    r = s * 0.3
    d.polygon([(cx - r * 0.7, cy - r), (cx - r * 0.7, cy + r), (cx + r * 1.05, cy)], fill=RED)
    return im


def font(size):
    for f in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def shelf(w, h):
    """Top Shelf banner: the icon and FAMILY TV, centered"""
    im = back(w, h)
    s = h * 0.3
    cx = w / 2 - s * 1.55
    im.alpha_composite(tv(w, h, cx=cx, s=s))
    im.alpha_composite(play(w, h, cx=cx, s=s))
    d = ImageDraw.Draw(im)
    f = font(round(h * 0.2))
    x = w / 2 - s * 0.45
    d.text((x, h * 0.53), "FAMILY", font=f, fill=WHITE, anchor="ls")
    d.text((x, h * 0.53 + h * 0.21), "TV", font=f, fill=RED, anchor="ls")
    return im.convert("RGB")


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(obj, fh, indent=2)


def imageset(folder, images):
    """images: list of (filename, scale, PIL image)"""
    os.makedirs(folder, exist_ok=True)
    for name, _, im in images:
        im.save(os.path.join(folder, name))
    write_json(os.path.join(folder, "Contents.json"),
               {"images": [{"filename": n, "idiom": "tv", "scale": sc} for n, sc, _ in images], "info": INFO})


def imagestack(folder, w, h, scales):
    layers = [("Front", play), ("Middle", tv), ("Back", back)]
    for name, draw in layers:
        layer = os.path.join(folder, f"{name}.imagestacklayer")
        write_json(os.path.join(layer, "Contents.json"), {"info": INFO})
        imageset(os.path.join(layer, "Content.imageset"),
                 [(f"{name.lower()}{'' if sc == 1 else f'@{sc}x'}.png", f"{sc}x", draw(w * sc, h * sc)) for sc in scales])
    write_json(os.path.join(folder, "Contents.json"), {"info": INFO, "layers": [{"filename": f"{n}.imagestacklayer"} for n, _ in layers]})


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    write_json(os.path.join(OUT, "Contents.json"), {"info": INFO})
    write_json(os.path.join(OUT, "AccentColor.colorset", "Contents.json"), {"colors": [{"idiom": "universal", "color": {
        "color-space": "srgb", "components": {"red": "0.898", "green": "0.220", "blue": "0.231", "alpha": "1.000"}}}], "info": INFO})
    brand = os.path.join(OUT, "App Icon & Top Shelf Image.brandassets")
    imagestack(os.path.join(brand, "App Icon.imagestack"), 400, 240, [1, 2])
    imagestack(os.path.join(brand, "App Icon - App Store.imagestack"), 1280, 768, [1])
    imageset(os.path.join(brand, "Top Shelf Image.imageset"), [("shelf.png", "1x", shelf(1920, 720)), ("shelf@2x.png", "2x", shelf(3840, 1440))])
    imageset(os.path.join(brand, "Top Shelf Image Wide.imageset"), [("wide.png", "1x", shelf(2320, 720)), ("wide@2x.png", "2x", shelf(4640, 1440))])
    write_json(os.path.join(brand, "Contents.json"), {"assets": [
        {"filename": "App Icon - App Store.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "1280x768"},
        {"filename": "App Icon.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "400x240"},
        {"filename": "Top Shelf Image Wide.imageset", "idiom": "tv", "role": "top-shelf-image-wide", "size": "2320x720"},
        {"filename": "Top Shelf Image.imageset", "idiom": "tv", "role": "top-shelf-image", "size": "1920x720"},
    ], "info": INFO})
    # a flattened preview, handy for checking the design
    prev = back(800, 480); prev.alpha_composite(tv(800, 480)); prev.alpha_composite(play(800, 480))
    prev.convert("RGB").save(os.path.join(HERE, "icon-preview.png"))
    print("assets written to", OUT)


if __name__ == "__main__":
    main()
