#!/usr/bin/env python3
"""Generates the 'Emoji Munchers' Construct 3 project (.c3p) from scratch.

Structure and ACE ids verified against a real open-source Construct 3 project
(GGJ2023-roots-game) and the official Construct 3 CDN ACE schema (allAces.json,
r495) so the generated event sheets use only real, existing conditions/actions.
"""
import json, os, random, shutil, zipfile
from PIL import Image, ImageDraw

random.seed(42)

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "build", "EmojiMunchers")
IMAGES = os.path.join(OUT, "images")

# ---------------------------------------------------------------- SID / UID
_sid_counter = random.randint(1, 9) * 10**14

def sid():
    global _sid_counter
    _sid_counter += random.randint(1000, 99999)
    return _sid_counter

_uid_counter = 0

def uid():
    global _uid_counter
    _uid_counter += 1
    return _uid_counter

def img_id():
    return random.randint(100000, 9999999)

# ---------------------------------------------------------------- Event sheet builders
def var(name, vtype, initial, comment=""):
    return {"eventType": "variable", "name": name, "type": vtype,
            "initialValue": str(initial), "comment": comment,
            "isStatic": False, "isConstant": False, "sid": sid()}

def comment(text):
    return {"eventType": "comment", "text": text}

def group(title, children, isActiveOnStart=True):
    return {"eventType": "group", "disabled": False, "title": title,
            "description": "", "isActiveOnStart": isActiveOnStart,
            "children": children, "sid": sid()}

def cond(id_, objectClass, params=None, behaviorType=None, isInverted=None):
    c = {"id": id_, "objectClass": objectClass, "sid": sid()}
    if params is not None:
        c["parameters"] = params
    if behaviorType is not None:
        c["behaviorType"] = behaviorType
    if isInverted:
        c["isInverted"] = True
    return c

def act(id_, objectClass, params=None, behaviorType=None):
    a = {"id": id_, "objectClass": objectClass, "sid": sid()}
    if params is not None:
        a["parameters"] = params
    if behaviorType is not None:
        a["behaviorType"] = behaviorType
    return a

def blk(conditions, actions, children=None, isOrBlock=None):
    b = {"eventType": "block", "conditions": conditions, "actions": actions, "sid": sid()}
    if children is not None:
        b["children"] = children
    if isOrBlock:
        b["isOrBlock"] = True
    return b

def q(s):
    """Quote a literal string for use inside a Construct expression."""
    return '"' + s.replace('"', '""') + '"'

# ---------------------------------------------------------------- Game data
CATEGORIES = ["Animals", "Fruits", "Vehicles", "Sports", "Weather", "Faces", "Instruments"]
POOLS = [
    ["\U0001F436", "\U0001F431", "\U0001F981", "\U0001F418", "\U0001F427", "\U0001F422", "\U0001F98A", "\U0001F434"],  # Animals
    ["\U0001F34E", "\U0001F34C", "\U0001F347", "\U0001F353", "\U0001F34D", "\U0001F351", "\U0001F349", "\U0001F95D"],  # Fruits
    ["\U0001F697", "\U0001F695", "\U0001F68C", "\U0001F693", "\U0001F691", "\U0001F692", "\U0001F680", "\U0001F681"],  # Vehicles
    ["⚽", "\U0001F3C0", "\U0001F3C8", "⚾", "\U0001F3BE", "\U0001F3D0", "\U0001F3D3", "\U0001F94A"],          # Sports
    ["\U0001F31E", "\U0001F327", "⛄", "\U0001F308", "⛈", "❄", "\U0001F32A", "\U0001F30A"],             # Weather
    ["\U0001F600", "\U0001F622", "\U0001F621", "\U0001F631", "\U0001F634", "\U0001F973", "\U0001F60E", "\U0001F914"], # Faces
    ["\U0001F3B8", "\U0001F3B9", "\U0001F941", "\U0001F3BA", "\U0001F3BB", "\U0001F3B7", "\U0001F4EF", "\U0001FA97"], # Instruments
]
CATEGORY_NAMES_STR = ",".join(CATEGORIES)
POOLS_ALL_STR = ";".join(",".join(p) for p in POOLS)

# ---------------------------------------------------------------- Grid geometry
CELL = 60
COLS = 7
ROWS = 6
GRID_X = 10
GRID_Y = 90
VIEW_W = 440
VIEW_H = 480

def cx(col):
    return GRID_X + col * CELL + CELL // 2

def cy(row):
    return GRID_Y + row * CELL + CELL // 2

# ---------------------------------------------------------------- Images
def make_images():
    os.makedirs(IMAGES, exist_ok=True)

    def save(name, im):
        im.save(os.path.join(IMAGES, name))

    # Cell background (soft card look). Two identical frames: frame 0 = "wrong
    # for current keyword", frame 1 = "right for current keyword" -- a hidden
    # data flag only, both frames render identically so nothing is revealed.
    im = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([2, 2, CELL - 3, CELL - 3], radius=10, fill=(235, 240, 250, 255), outline=(150, 165, 200, 255), width=2)
    save("cell-default-000.png", im)
    save("cell-default-001.png", im)

    # Player (muncher) - a friendly rounded triangle/pac-like blob
    size = 52
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([2, 2, size - 3, size - 3], fill=(255, 196, 20, 255), outline=(180, 130, 0, 255), width=3)
    d.pieslice([2, 2, size - 3, size - 3], start=-25, end=25, fill=(0, 0, 0, 0))
    d.polygon([(size / 2, size / 2), (size - 4, size * 0.28), (size - 4, size * 0.72)], fill=(0, 0, 0, 0))
    d.ellipse([size * 0.55, size * 0.22, size * 0.65, size * 0.32], fill=(60, 40, 0, 255))
    save("player-default-000.png", im)

    # Troggle enemy - spiky purple blob
    size = 52
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cxp, cyp, r = size / 2, size / 2, size / 2 - 6
    pts = []
    import math
    for i in range(10):
        ang = math.pi * 2 * i / 10
        rr = r if i % 2 == 0 else r * 0.6
        pts.append((cxp + rr * math.cos(ang), cyp + rr * math.sin(ang)))
    d.polygon(pts, fill=(150, 60, 180, 255), outline=(90, 20, 120, 255))
    d.ellipse([size * 0.30, size * 0.38, size * 0.42, size * 0.50], fill=(255, 255, 255, 255))
    d.ellipse([size * 0.58, size * 0.38, size * 0.70, size * 0.50], fill=(255, 255, 255, 255))
    d.ellipse([size * 0.33, size * 0.41, size * 0.39, size * 0.47], fill=(0, 0, 0, 255))
    d.ellipse([size * 0.61, size * 0.41, size * 0.67, size * 0.47], fill=(0, 0, 0, 255))
    save("troggle-default-000.png", im)

    # Invisible wall (1x1 transparent, size doesn't matter much)
    im = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    save("wall-default-000.png", im)

    # Restart button
    im = Image.new("RGBA", (160, 46), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([1, 1, 158, 44], radius=10, fill=(70, 150, 90, 255), outline=(30, 90, 45, 255), width=3)
    save("restartbtn-default-000.png", im)


IMG_SIZES = {
    "Cell": (CELL, CELL),
    "Player": (52, 52),
    "Troggle": (52, 52),
    "Wall": (CELL, CELL),
    "RestartBtn": (160, 46),
}

# ---------------------------------------------------------------- Object type files
def sprite_object_type(name, w, h, instance_vars=None, behaviors=None, origin_center=True, frame_count=1):
    ox = 0.5 if origin_center else 0.0
    oy = 0.5 if origin_center else 0.0
    poly = {"points": [0, 0, 1, 0, 1, 1, 0, 1]}
    frames = []
    for _ in range(frame_count):
        frames.append({
            "width": w, "height": h, "originX": ox, "originY": oy,
            "originalSource": "", "exportFormat": "lossless", "exportQuality": 0.8,
            "imageSpriteId": img_id(), "collisionPoly": poly, "useCollisionPoly": True,
            "duration": 1,
        })
    anim = {"frames": frames, "sid": sid(), "name": "default", "isLooping": False,
            "isPingPong": False, "repeatCount": 1, "repeatTo": 0, "speed": 0}
    ivars = []
    for v in (instance_vars or []):
        ivars.append({"name": v[0], "type": v[1], "desc": "", "show": True, "sid": sid()})
    btypes = []
    for b in (behaviors or []):
        btypes.append({"behaviorId": b[0], "name": b[1], "sid": sid()})
    return {
        "name": name, "plugin-id": "Sprite", "sid": sid(), "isGlobal": False,
        "instanceVariables": ivars, "behaviorTypes": btypes, "effectTypes": [],
        "animations": {"items": [anim], "subfolders": []},
    }

def text_object_type(name, instance_vars=None):
    ivars = []
    for v in (instance_vars or []):
        ivars.append({"name": v[0], "type": v[1], "desc": "", "show": True, "sid": sid()})
    return {"name": name, "plugin-id": "Text", "sid": sid(), "isGlobal": False,
            "instanceVariables": ivars, "behaviorTypes": [], "effectTypes": []}

def plugin_singleton(name, plugin_id):
    return {"name": name, "plugin-id": plugin_id, "sid": sid(),
            "singleglobal-inst": {"type": plugin_id, "properties": {}, "uid": uid()}}

# ---------------------------------------------------------------- Layout instance helpers
def sprite_instance(type_name, x, y, w, h, origin_center=True, instance_vars=None,
                     behaviors=None, visible=True, animation="default"):
    ox = 0.5 if origin_center else 0.0
    oy = 0.5 if origin_center else 0.0
    b = {}
    for beh_name, props in (behaviors or {}).items():
        b[beh_name] = {"properties": props}
    return {
        "type": type_name,
        "properties": {"initially-visible": visible, "initial-animation": animation,
                        "initial-frame": 0, "enable-collisions": True, "live-preview": False},
        "uid": uid(),
        "instanceVariables": dict(instance_vars or {}),
        "behaviors": b,
        "world": {"x": x, "y": y, "width": w, "height": h, "originX": ox, "originY": oy,
                  "color": [1, 1, 1, 1], "angle": 0, "zElevation": 0},
    }

def text_instance(type_name, x, y, w, h, text="", size=16, bold=False, color=(1, 1, 1, 1),
                   halign="center", valign="center", visible=True):
    return {
        "type": type_name,
        "properties": {
            "text": text, "enable-bbcode": False, "font": "Arial", "size": size,
            "line-height": 0, "bold": bold, "italic": False,
            "color": [color[0], color[1], color[2], color[3]],
            "horizontal-alignment": halign, "vertical-alignment": valign,
            "wrapping": "word", "initially-visible": visible, "origin": "top-left",
            "read-aloud": False,
        },
        "uid": uid(),
        "instanceVariables": {},
        "behaviors": {},
        "world": {"x": x, "y": y, "width": w, "height": h, "originX": 0, "originY": 0,
                  "color": [1, 1, 1, 1], "angle": 0, "zElevation": 0},
    }

# ================================================================== BUILD
def build():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    make_images()

    for sub in ["layouts", "eventSheets", "objectTypes"]:
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)

    # ---------------- object types
    object_types = {}

    object_types["Cell"] = sprite_object_type(
        "Cell", CELL, CELL, frame_count=2)
    object_types["Player"] = sprite_object_type(
        "Player", *IMG_SIZES["Player"],
        behaviors=[("TileMovement", "TileMovement"), ("bound", "BoundToLayout")])
    object_types["Troggle"] = sprite_object_type(
        "Troggle", *IMG_SIZES["Troggle"],
        behaviors=[("TileMovement", "TileMovement"), ("bound", "BoundToLayout")])
    object_types["Wall"] = sprite_object_type(
        "Wall", CELL, CELL, origin_center=False,
        behaviors=[("solid", "Solid")])
    object_types["RestartBtn"] = sprite_object_type(
        "RestartBtn", *IMG_SIZES["RestartBtn"], origin_center=False)

    object_types["EmojiText"] = text_object_type("EmojiText")
    object_types["KeywordText"] = text_object_type("KeywordText")
    object_types["ScoreText"] = text_object_type("ScoreText")
    object_types["LivesText"] = text_object_type("LivesText")
    object_types["LevelText"] = text_object_type("LevelText")
    object_types["GameOverText"] = text_object_type("GameOverText")
    object_types["RestartLabel"] = text_object_type("RestartLabel")

    object_types["Mouse"] = plugin_singleton("Mouse", "Mouse")

    for name, ot in object_types.items():
        with open(os.path.join(OUT, "objectTypes", f"{name}.json"), "w") as f:
            json.dump(ot, f, indent=1)

    # ---------------- layout
    layers = []

    # Cells themselves are created dynamically each round (see "Board generation"
    # below). Only the emoji labels are pre-placed here, once per grid position,
    # and persist for the whole game -- their .Text is just cleared/rewritten.
    cells_instances = []
    for row in range(ROWS):
        for col in range(COLS):
            x, y = cx(col), cy(row)
            cells_instances.append(text_instance(
                "EmojiText", x - CELL / 2, y - CELL / 2, CELL, CELL,
                text="", size=30, halign="center", valign="center", color=(0.1, 0.1, 0.15, 1)))

    layers.append({
        "name": "Cells", "overriden": 0, "subLayers": [], "instances": cells_instances,
        "sid": sid(), "effectTypes": [], "isInitiallyVisible": True, "isInitiallyInteractive": True,
        "color": [1, 1, 1, 1], "backgroundColor": [0.86, 0.89, 0.95, 1], "isTransparent": False,
        "parallaxX": 1, "parallaxY": 1, "scaleRate": 1, "forceOwnTexture": False,
        "renderingMode": "3d", "drawOrder": "z-order", "useRenderCells": False,
        "blendMode": "normal", "zElevation": 0, "global": False,
    })

    actor_instances = [
        sprite_instance("Player", cx(0), cy(ROWS - 1), *IMG_SIZES["Player"],
                         behaviors={"TileMovement": {
                             "grid-width": CELL, "grid-height": CELL,
                             "grid-offset-x": GRID_X + CELL // 2, "grid-offset-y": GRID_Y + CELL // 2,
                             "speed-x": 240, "speed-y": 240, "enabled": True,
                             "default-controls": True, "isometric": False},
                             "bound": {"bound-by": "edge"}}),
        sprite_instance("Troggle", cx(COLS - 1), cy(0), *IMG_SIZES["Troggle"],
                         behaviors={"TileMovement": {
                             "grid-width": CELL, "grid-height": CELL,
                             "grid-offset-x": GRID_X + CELL // 2, "grid-offset-y": GRID_Y + CELL // 2,
                             "speed-x": 180, "speed-y": 180, "enabled": True,
                             "default-controls": False, "isometric": False},
                             "bound": {"bound-by": "edge"}}),
        sprite_instance("Troggle", cx(COLS - 1), cy(ROWS - 1), *IMG_SIZES["Troggle"],
                         behaviors={"TileMovement": {
                             "grid-width": CELL, "grid-height": CELL,
                             "grid-offset-x": GRID_X + CELL // 2, "grid-offset-y": GRID_Y + CELL // 2,
                             "speed-x": 180, "speed-y": 180, "enabled": True,
                             "default-controls": False, "isometric": False},
                             "bound": {"bound-by": "edge"}}),
    ]
    layers.append({
        "name": "Actors", "overriden": 0, "subLayers": [], "instances": actor_instances,
        "sid": sid(), "effectTypes": [], "isInitiallyVisible": True, "isInitiallyInteractive": True,
        "color": [1, 1, 1, 1], "backgroundColor": [0.86, 0.89, 0.95, 1], "isTransparent": True,
        "parallaxX": 1, "parallaxY": 1, "scaleRate": 1, "forceOwnTexture": False,
        "renderingMode": "3d", "drawOrder": "z-order", "useRenderCells": False,
        "blendMode": "normal", "zElevation": 0, "global": False,
    })

    ui_instances = [
        text_instance("KeywordText", 0, 8, VIEW_W, 34, text="Find:", size=22, bold=True,
                      color=(1, 1, 1, 1), halign="center", valign="center"),
        text_instance("ScoreText", 8, 46, 140, 24, text="Score: 0", size=15, bold=True,
                      color=(1, 0.9, 0.3, 1), halign="left", valign="center"),
        text_instance("LivesText", VIEW_W - 148, 46, 140, 24, text="Lives: 3", size=15, bold=True,
                      color=(1, 0.5, 0.5, 1), halign="right", valign="center"),
        text_instance("LevelText", VIEW_W / 2 - 70, 46, 140, 24, text="Level: 1", size=15, bold=True,
                      color=(0.7, 0.9, 1, 1), halign="center", valign="center"),
        text_instance("GameOverText", 0, VIEW_H / 2 - 70, VIEW_W, 40, text="GAME OVER", size=28,
                      bold=True, color=(1, 0.3, 0.3, 1), halign="center", valign="center", visible=False),
        sprite_instance("RestartBtn", VIEW_W / 2 - 80, VIEW_H / 2 - 10, *IMG_SIZES["RestartBtn"],
                         origin_center=False, visible=False),
        text_instance("RestartLabel", VIEW_W / 2 - 80, VIEW_H / 2 - 10, 160, 46, text="Play Again",
                      size=16, bold=True, color=(1, 1, 1, 1), halign="center", valign="center", visible=False),
    ]
    layers.append({
        "name": "UI", "overriden": 0, "subLayers": [], "instances": ui_instances,
        "sid": sid(), "effectTypes": [], "isInitiallyVisible": True, "isInitiallyInteractive": True,
        "color": [1, 1, 1, 1], "backgroundColor": [0.1, 0.12, 0.22, 1], "isTransparent": True,
        "parallaxX": 1, "parallaxY": 1, "scaleRate": 1, "forceOwnTexture": False,
        "renderingMode": "3d", "drawOrder": "z-order", "useRenderCells": False,
        "blendMode": "normal", "zElevation": 0, "global": False,
    })

    layout = {"name": "Game", "layers": layers}
    with open(os.path.join(OUT, "layouts", "Game.json"), "w") as f:
        json.dump(layout, f, indent=1)

    # ---------------- event sheet
    events = []

    # --- Global variables
    events.append(comment("=== Backend database: category names + their matching emoji pools ==="))
    events.append(var("CategoryNames", "string", q(CATEGORY_NAMES_STR),
                       "Comma-separated list of the 7 playable keyword categories."))
    events.append(var("PoolsAll", "string", q(POOLS_ALL_STR),
                       "Semicolon-separated groups (aligned by index with CategoryNames); each group is a comma-separated list of the emoji that belong to that category. This is the 'backend database' the game checks munches against."))
    events.append(var("KeywordIndex", "number", 0, ""))
    events.append(var("CurrentKeyword", "string", q(""), ""))
    events.append(var("CurrentPool", "string", q(""), ""))
    events.append(var("TempEmoji", "string", q(""), ""))
    events.append(var("Score", "number", 0, ""))
    events.append(var("Lives", "number", 3, ""))
    events.append(var("Level", "number", 0, ""))
    events.append(var("RemainingCorrect", "number", 0, ""))
    events.append(var("IsGameOver", "boolean", "false", ""))
    events.append(var("TriggerNewBoard", "boolean", "true", ""))
    events.append(var("DirRoll", "number", 0, ""))

    # --- Border walls, created once
    wall_children = []
    wall_children.append(blk(
        [cond("for", "System", {"name": q("WallCol"), "start-index": "-1", "end-index": str(COLS)})],
        [
            act("create-object", "System", {"object-to-create": "Wall", "layer": "1",
                "x": f"{GRID_X} + loopindex(\"WallCol\") * {CELL}", "y": str(GRID_Y - CELL),
                "create-hierarchy": False, "template-name": q("")}),
            act("create-object", "System", {"object-to-create": "Wall", "layer": "1",
                "x": f"{GRID_X} + loopindex(\"WallCol\") * {CELL}", "y": str(GRID_Y + ROWS * CELL),
                "create-hierarchy": False, "template-name": q("")}),
        ]))
    wall_children.append(blk(
        [cond("for", "System", {"name": q("WallRow"), "start-index": "0", "end-index": str(ROWS - 1)})],
        [
            act("create-object", "System", {"object-to-create": "Wall", "layer": "1",
                "x": str(GRID_X - CELL), "y": f"{GRID_Y} + loopindex(\"WallRow\") * {CELL}",
                "create-hierarchy": False, "template-name": q("")}),
            act("create-object", "System", {"object-to-create": "Wall", "layer": "1",
                "x": str(GRID_X + COLS * CELL), "y": f"{GRID_Y} + loopindex(\"WallRow\") * {CELL}",
                "create-hierarchy": False, "template-name": q("")}),
        ]))

    on_start = blk(
        [cond("on-start-of-layout", "System")],
        [act("set-boolean-eventvar", "System", {"variable": "TriggerNewBoard", "value": "true"})],
        children=wall_children,
    )
    events.append(group("Setup", [comment("Runs once: build the invisible border walls that keep the muncher and troggles on the grid."), on_start]))

    # --- Board (re)generation, driven by TriggerNewBoard.
    # Correctness is stored as the Cell's animation frame (0 = wrong, 1 = right
    # for the current keyword) -- the same hidden-state-via-frame-number trick
    # proven by the reference project's own tile grid, rather than an
    # instance-variable action family that couldn't be verified against any
    # real Construct 3 project or the official ACE schema.
    reshuffle_children = []

    correct_check = blk(
        [cond("compare-two-values", "System", {
            "first-value": 'find(CurrentPool, TempEmoji)', "comparison": 5, "second-value": "0"})],
        [
            act("set-animation-frame", "Cell", {"frame-number": "1"}),
            act("add-to-eventvar", "System", {"variable": "RemainingCorrect", "value": "1"}),
        ],
    )
    incorrect_set = blk(
        [cond("else", "System")],
        [act("set-animation-frame", "Cell", {"frame-number": "0"})],
    )

    per_cell_block = blk(
        [cond("for", "System", {"name": q("Grid Row"), "start-index": "0", "end-index": str(ROWS - 1)})],
        [],
        children=[blk(
            [cond("for", "System", {"name": q("Grid Col"), "start-index": "0", "end-index": str(COLS - 1)})],
            [
                act("create-object", "System", {"object-to-create": "Cell", "layer": "0",
                    "x": f'{GRID_X} + loopindex("Grid Col") * {CELL} + {CELL // 2}',
                    "y": f'{GRID_Y} + loopindex("Grid Row") * {CELL} + {CELL // 2}',
                    "create-hierarchy": False, "template-name": q("")}),
                act("set-eventvar-value", "System", {"variable": "TempEmoji",
                    "value": 'tokenat(replace(PoolsAll, ";", ","), int(random(tokencount(replace(PoolsAll, ";", ","), ","))), ",")'}),
            ],
            children=[
                comment("Find the pre-placed emoji label at this same grid position and write the freshly-picked emoji into it."),
                blk(
                    [cond("pick-overlapping-point", "System", {"object": "EmojiText", "x": "Cell.X", "y": "Cell.Y"})],
                    [act("set-text", "EmojiText", {"text": "TempEmoji"})],
                ),
                comment("Compare against the backend database (PoolsAll) to decide if this emoji matches the current keyword."),
                correct_check,
                incorrect_set,
            ],
        )],
    )

    reshuffle_children.append(comment("Clear any cells left from the previous round."))
    reshuffle_children.append(blk(
        [cond("for-each", "System", {"object": "Cell"})],
        [act("destroy", "Cell")],
    ))
    reshuffle_children.append(comment("Pick a new random keyword and its matching emoji pool from the backend database."))
    reshuffle_children.append(blk([], [
        act("set-eventvar-value", "System", {"variable": "TriggerNewBoard", "value": "false"}),
        act("add-to-eventvar", "System", {"variable": "Level", "value": "1"}),
        act("set-eventvar-value", "System", {"variable": "KeywordIndex", "value": "int(random(tokencount(CategoryNames, \",\")))"}),
        act("set-eventvar-value", "System", {"variable": "CurrentKeyword", "value": "tokenat(CategoryNames, KeywordIndex, \",\")"}),
        act("set-eventvar-value", "System", {"variable": "CurrentPool", "value": "tokenat(PoolsAll, KeywordIndex, \";\")"}),
        act("set-eventvar-value", "System", {"variable": "RemainingCorrect", "value": "0"}),
        act("set-text", "KeywordText", {"text": '"Find: " & CurrentKeyword'}),
        act("set-text", "LevelText", {"text": '"Level: " & Level'}),
    ]))
    reshuffle_children.append(per_cell_block)

    reshuffle_block = blk(
        [cond("compare-boolean-eventvar", "System", {"variable": "TriggerNewBoard"}),
         cond("trigger-once-while-true", "System")],
        [],
        children=reshuffle_children,
    )
    events.append(group("Board generation", [reshuffle_block]))

    # --- Munching. Eaten cells are simply destroyed (proven action) rather than
    # hidden behind an "eaten" instance variable, so a destroyed cell can never
    # be munched twice -- it no longer exists.
    munch_correct = blk(
        [cond("compare-animation-frame", "Cell", {"comparison": 0, "number": "1"})],
        [
            act("add-to-eventvar", "System", {"variable": "Score", "value": "10"}),
            act("subtract-from-eventvar", "System", {"variable": "RemainingCorrect", "value": "1"}),
            act("set-text", "ScoreText", {"text": '"Score: " & Score'}),
            act("destroy", "Cell"),
        ],
        children=[blk(
            [cond("pick-overlapping-point", "System", {"object": "EmojiText", "x": "Cell.X", "y": "Cell.Y"})],
            [act("set-text", "EmojiText", {"text": q("")})],
        )],
    )
    munch_wrong = blk(
        [cond("else", "System")],
        [
            act("subtract-from-eventvar", "System", {"variable": "Lives", "value": "1"}),
            act("set-text", "LivesText", {"text": '"Lives: " & Lives'}),
            act("destroy", "Cell"),
        ],
        children=[blk(
            [cond("pick-overlapping-point", "System", {"object": "EmojiText", "x": "Cell.X", "y": "Cell.Y"})],
            [act("set-text", "EmojiText", {"text": q("")})],
        )],
    )
    munch_event = blk(
        [
            cond("is-overlapping-another-object", "Player", {"object": "Cell"}),
            cond("trigger-once-while-true", "System"),
        ],
        [],
        children=[munch_correct, munch_wrong],
    )
    events.append(group("Munching", [
        blk([cond("compare-boolean-eventvar", "System", {"variable": "IsGameOver"}, isInverted=True)], [], children=[munch_event]),
    ]))

    # --- Round complete -> trigger a fresh board
    round_complete = blk(
        [
            cond("compare-eventvar", "System", {"variable": "RemainingCorrect", "comparison": 3, "value": "0"}),
            cond("compare-boolean-eventvar", "System", {"variable": "IsGameOver"}, isInverted=True),
            cond("trigger-once-while-true", "System"),
        ],
        [act("set-boolean-eventvar", "System", {"variable": "TriggerNewBoard", "value": "true"})],
    )
    events.append(group("Round complete", [round_complete]))

    # --- Troggle AI: wander in a random cardinal direction periodically
    dir_choices = ["left", "right", "up", "down"]
    dir_children = []
    for i, d in enumerate(dir_choices):
        dir_children.append(blk(
            [cond("compare-eventvar", "System", {"variable": "DirRoll", "comparison": 0, "value": str(i)})],
            [act("simulate-control", "Troggle", {"control": d}, behaviorType="TileMovement")],
        ))
    troggle_ai = blk(
        [cond("for-each", "System", {"object": "Troggle"}),
         cond("every-x-seconds", "System", {"interval-seconds": "1.2"})],
        [act("set-eventvar-value", "System", {"variable": "DirRoll", "value": "int(random(4))"})],
        children=dir_children,
    )
    events.append(group("Troggle wandering", [
        blk([cond("compare-boolean-eventvar", "System", {"variable": "IsGameOver"}, isInverted=True)], [], children=[troggle_ai]),
    ]))

    # --- Player <-> Troggle collision
    troggle_hit = blk(
        [
            cond("is-overlapping-another-object", "Player", {"object": "Troggle"}),
            cond("trigger-once-while-true", "System"),
        ],
        [
            act("subtract-from-eventvar", "System", {"variable": "Lives", "value": "1"}),
            act("set-text", "LivesText", {"text": '"Lives: " & Lives'}),
            act("set-grid-position", "Player", {"x": str(cx(0)), "y": str(cy(ROWS - 1)), "instant": "instant"}, behaviorType="TileMovement"),
        ],
    )
    events.append(group("Troggle collision", [
        blk([cond("compare-boolean-eventvar", "System", {"variable": "IsGameOver"}, isInverted=True)], [], children=[troggle_hit]),
    ]))

    # --- Game over trigger
    game_over = blk(
        [
            cond("compare-eventvar", "System", {"variable": "Lives", "comparison": 3, "value": "0"}),
            cond("compare-boolean-eventvar", "System", {"variable": "IsGameOver"}, isInverted=True),
            cond("trigger-once-while-true", "System"),
        ],
        [
            act("set-boolean-eventvar", "System", {"variable": "IsGameOver", "value": "true"}),
            act("set-enabled", "Player", {"state": "disabled"}, behaviorType="TileMovement"),
            act("set-visible", "GameOverText", {"visibility": "visible"}),
            act("set-visible", "RestartBtn", {"visibility": "visible"}),
            act("set-visible", "RestartLabel", {"visibility": "visible"}),
        ],
        children=[blk(
            [cond("for-each", "System", {"object": "Troggle"})],
            [act("set-enabled", "Troggle", {"state": "disabled"}, behaviorType="TileMovement")],
        )],
    )
    events.append(group("Game over", [game_over]))

    # --- Restart button
    restart_event = blk(
        [cond("on-object-clicked", "Mouse", {"mouse-button": "left", "click-type": "clicked", "object-clicked": "RestartBtn"})],
        [act("restart-layout", "System")],
    )
    events.append(group("Restart", [restart_event]))

    sheet = {"name": "Game", "events": events, "sid": sid()}
    with open(os.path.join(OUT, "eventSheets", "Game.json"), "w") as f:
        json.dump(sheet, f, indent=1)

    # ---------------- project.c3proj
    def otree(items):
        return {"items": items, "subfolders": []}

    project = {
        "projectFormatVersion": 1,
        "savedWithRelease": 49500,
        "name": "Emoji Munchers",
        "runtime": "c3",
        "useWorker": "auto",
        "bundleAddons": False,
        "usedAddons": [
            {"type": "plugin", "id": "Sprite", "name": "Sprite", "author": "Scirra", "bundled": False},
            {"type": "plugin", "id": "Text", "name": "Text", "author": "Scirra", "bundled": False},
            {"type": "plugin", "id": "Mouse", "name": "Mouse", "author": "Scirra", "bundled": False},
            {"type": "behavior", "id": "TileMovement", "name": "Tile movement", "author": "Scirra", "bundled": False},
            {"type": "behavior", "id": "bound", "name": "Bound to layout", "author": "Scirra", "bundled": False},
            {"type": "behavior", "id": "solid", "name": "Solid", "author": "Scirra", "bundled": False},
        ],
        "uniqueId": "emojimunchers1",
        "objectTypes": otree([
            "Cell", "Player", "Troggle", "Wall", "RestartBtn", "EmojiText", "KeywordText",
            "ScoreText", "LivesText", "LevelText", "GameOverText", "RestartLabel", "Mouse",
        ]),
        "autosaveData": None,
        "containers": [],
        "families": {"items": [], "subfolders": []},
        "layouts": otree(["Game"]),
        "eventSheets": otree(["Game"]),
        "rootFileFolders": {
            "script": {"items": [], "subfolders": []},
            "sound": {"items": [], "subfolders": []},
            "music": {"items": [], "subfolders": []},
            "video": {"items": [], "subfolders": []},
            "font": {"items": [], "subfolders": []},
            "icon": {"items": [], "subfolders": []},
            "general": {"items": [], "subfolders": []},
        },
        "timelines": {"items": [], "subfolders": []},
        "properties": {
            "description": "Munch the emoji that match the keyword!", "version": "1.0.0.0",
            "author": "", "authorEmail": "", "authorWebsite": "", "appId": "",
            "pixelRounding": True, "zAxisScale": "normalized", "fov": 0.7853981633974483,
            "useLoaderLayout": False, "fullscreenMode": "letterbox-scale", "fullscreenQuality": "high",
            "viewportFit": "auto", "backgroundColor": [0.1, 0.12, 0.22, 1], "splashColor": [1, 1, 1, 0],
            "useThemeColor": False, "themeColor": [1, 1, 1, 0], "orientations": "any",
            "webgpu": "auto", "gpuPreference": "high-performance", "scriptsType": "module",
            "framerateMode": "vsync", "compositingMode": "standard", "sampling": "nearest",
            "downscaling": "medium", "renderingMode": "auto", "anisotropicFiltering": "auto",
            "zNear": 1, "zFar": 10000, "maxSpriteSheetSize": 2048, "loaderStyle": "splash",
            "preloadSounds": True, "cordovaiOSScheme": "app", "cordovaAndroidScheme": "https",
            "autoReloadScriptsOnPreview": False, "exportFileStructure": "folders",
            "uidAllocationMode": "increment",
        },
        "viewportWidth": VIEW_W,
        "viewportHeight": VIEW_H,
        "firstLayout": "Game",
    }
    with open(os.path.join(OUT, "project.c3proj"), "w") as f:
        json.dump(project, f, indent=1)

    # ---------------- zip into .c3p
    c3p_path = os.path.join(ROOT, "EmojiMunchers.c3p")
    if os.path.exists(c3p_path):
        os.remove(c3p_path)
    with zipfile.ZipFile(c3p_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, _, files in os.walk(OUT):
            for fn in files:
                full = os.path.join(base, fn)
                rel = os.path.relpath(full, OUT)
                zf.write(full, rel)

    print("Built:", c3p_path)
    print("Cells:", ROWS * COLS, "Categories:", CATEGORIES)


if __name__ == "__main__":
    build()
