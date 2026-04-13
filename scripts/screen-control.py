#!/usr/bin/env python3
"""
DIY Computer Use — Screenshot, mouse, and keyboard control via python-xlib.
Usage:
  python3 screen-control.py screenshot [output.png]
  python3 screen-control.py click <x> <y>
  python3 screen-control.py doubleclick <x> <y>
  python3 screen-control.py rightclick <x> <y>
  python3 screen-control.py move <x> <y>
  python3 screen-control.py type <text>
  python3 screen-control.py key <keyname>  (e.g., Return, Tab, Escape, ctrl+s)
  python3 screen-control.py drag <x1> <y1> <x2> <y2>
  python3 screen-control.py window-info          (list windows)
  python3 screen-control.py focus <window_name>  (focus+raise a window)
  python3 screen-control.py screenshot-window <window_name> [output.png]
"""

import sys
import time
from Xlib import display, X, Xatom, XK
from Xlib.ext.xtest import fake_input
from PIL import Image


def get_display():
    return display.Display(':1')


def screenshot(d, output='/tmp/gitslop-screenshot.png', window=None):
    """Take a screenshot of the root window or a specific window."""
    if window is None:
        root = d.screen().root
        geo = root.get_geometry()
        w, h = geo.width, geo.height
        raw = root.get_image(0, 0, w, h, X.ZPixmap, 0xffffffff)
    else:
        geo = window.get_geometry()
        w, h = geo.width, geo.height
        raw = window.get_image(0, 0, w, h, X.ZPixmap, 0xffffffff)

    img = Image.frombytes('RGBX', (w, h), raw.data, 'raw', 'BGRX')
    img = img.convert('RGB')
    img.save(output)
    print(f'Screenshot saved: {output} ({w}x{h})')
    return output


def move_mouse(d, x, y):
    """Move mouse to absolute position."""
    root = d.screen().root
    fake_input(d, X.MotionNotify, x=x, y=y, root=root)
    d.sync()


def click(d, x, y, button=1):
    """Click at position. button: 1=left, 2=middle, 3=right."""
    move_mouse(d, x, y)
    time.sleep(0.05)
    root = d.screen().root
    fake_input(d, X.ButtonPress, button, root=root)
    d.sync()
    time.sleep(0.05)
    fake_input(d, X.ButtonRelease, button, root=root)
    d.sync()
    print(f'Clicked ({button}) at ({x}, {y})')


def double_click(d, x, y):
    """Double-click at position."""
    click(d, x, y)
    time.sleep(0.1)
    click(d, x, y)


def drag(d, x1, y1, x2, y2):
    """Drag from (x1,y1) to (x2,y2)."""
    root = d.screen().root
    move_mouse(d, x1, y1)
    time.sleep(0.05)
    fake_input(d, X.ButtonPress, 1, root=root)
    d.sync()
    time.sleep(0.1)
    # Move in steps for smooth drag
    steps = 20
    for i in range(1, steps + 1):
        ix = x1 + (x2 - x1) * i // steps
        iy = y1 + (y2 - y1) * i // steps
        move_mouse(d, ix, iy)
        time.sleep(0.01)
    time.sleep(0.05)
    fake_input(d, X.ButtonRelease, 1, root=root)
    d.sync()
    print(f'Dragged from ({x1},{y1}) to ({x2},{y2})')


def type_text(d, text):
    """Type text string."""
    for char in text:
        keysym = XK.string_to_keysym(char)
        if keysym == 0:
            # Try with special char mapping
            special = {
                ' ': 'space', '\n': 'Return', '\t': 'Tab',
                '/': 'slash', '\\': 'backslash', '-': 'minus',
                '=': 'equal', '[': 'bracketleft', ']': 'bracketright',
                ';': 'semicolon', "'": 'apostrophe', ',': 'comma',
                '.': 'period', '`': 'grave',
                '_': 'underscore', '(': 'parenleft', ')': 'parenright',
                '!': 'exclam', '@': 'at', '#': 'numbersign',
                '$': 'dollar', '%': 'percent', '^': 'asciicircum',
                '&': 'ampersand', '*': 'asterisk', '+': 'plus',
                '{': 'braceleft', '}': 'braceright', '|': 'bar',
                ':': 'colon', '"': 'quotedbl', '<': 'less',
                '>': 'greater', '?': 'question', '~': 'asciitilde',
            }
            if char in special:
                keysym = XK.string_to_keysym(special[char])
            else:
                continue

        keycode = d.keysym_to_keycode(keysym)
        if keycode == 0:
            continue

        # Check if shift is needed
        need_shift = char.isupper() or char in '~!@#$%^&*()_+{}|:"<>?'
        if need_shift:
            shift_code = d.keysym_to_keycode(XK.XK_Shift_L)
            fake_input(d, X.KeyPress, shift_code)
            d.sync()

        fake_input(d, X.KeyPress, keycode)
        d.sync()
        time.sleep(0.02)
        fake_input(d, X.KeyRelease, keycode)
        d.sync()

        if need_shift:
            fake_input(d, X.KeyRelease, shift_code)
            d.sync()

        time.sleep(0.02)
    print(f'Typed: {text[:50]}{"..." if len(text) > 50 else ""}')


def press_key(d, key_spec):
    """Press a key or key combo. E.g., 'Return', 'ctrl+s', 'alt+F4'."""
    parts = key_spec.split('+')
    modifiers = []
    key_name = parts[-1]

    mod_map = {
        'ctrl': XK.XK_Control_L,
        'alt': XK.XK_Alt_L,
        'shift': XK.XK_Shift_L,
        'super': XK.XK_Super_L,
    }

    for part in parts[:-1]:
        p = part.lower().strip()
        if p in mod_map:
            modifiers.append(mod_map[p])

    # Resolve key
    keysym = XK.string_to_keysym(key_name)
    if keysym == 0:
        # Try common names
        name_map = {
            'enter': 'Return', 'esc': 'Escape', 'del': 'Delete',
            'backspace': 'BackSpace', 'space': 'space',
            'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
            'tab': 'Tab', 'home': 'Home', 'end': 'End',
            'pageup': 'Prior', 'pagedown': 'Next',
        }
        resolved = name_map.get(key_name.lower(), key_name)
        keysym = XK.string_to_keysym(resolved)

    if keysym == 0:
        print(f'Unknown key: {key_name}')
        return

    keycode = d.keysym_to_keycode(keysym)

    # Press modifiers
    for mod_sym in modifiers:
        mod_code = d.keysym_to_keycode(mod_sym)
        fake_input(d, X.KeyPress, mod_code)
        d.sync()

    # Press and release key
    fake_input(d, X.KeyPress, keycode)
    d.sync()
    time.sleep(0.05)
    fake_input(d, X.KeyRelease, keycode)
    d.sync()

    # Release modifiers (reverse order)
    for mod_sym in reversed(modifiers):
        mod_code = d.keysym_to_keycode(mod_sym)
        fake_input(d, X.KeyRelease, mod_code)
        d.sync()

    print(f'Pressed: {key_spec}')


def find_window(d, name_pattern):
    """Find a window by name or WM_CLASS (substring match)."""
    root = d.screen().root
    name_pattern = name_pattern.lower()

    # First try _NET_CLIENT_LIST for top-level windows (more reliable)
    atom = d.intern_atom('_NET_CLIENT_LIST')
    resp = root.get_full_property(atom, Xatom.WINDOW)
    if resp:
        for wid in resp.value:
            w = d.create_resource_object('window', wid)
            try:
                wm_name = w.get_wm_name() or ''
                wm_class = w.get_wm_class() or ('', '')
                if (name_pattern in str(wm_name).lower() or
                    name_pattern in wm_class[0].lower() or
                    name_pattern in wm_class[1].lower()):
                    return w
            except Exception:
                pass

    # Fallback: recursive search
    def search(window):
        try:
            wm_name = window.get_wm_name()
            wm_class = window.get_wm_class() or ('', '')
            if ((wm_name and name_pattern in str(wm_name).lower()) or
                name_pattern in wm_class[0].lower() or
                name_pattern in wm_class[1].lower()):
                return window
        except Exception:
            pass

        try:
            children = window.query_tree().children
        except Exception:
            return None

        for child in children:
            result = search(child)
            if result:
                return result
        return None

    return search(root)


def list_windows(d):
    """List all visible windows."""
    root = d.screen().root
    atom = d.intern_atom('_NET_CLIENT_LIST')
    resp = root.get_full_property(atom, Xatom.WINDOW)
    if not resp:
        print('No windows found')
        return

    for wid in resp.value:
        w = d.create_resource_object('window', wid)
        try:
            name = w.get_wm_name() or '(unnamed)'
            geo = w.get_geometry()
            print(f'  {wid:#010x}  {geo.width}x{geo.height}  {name}')
        except Exception:
            pass


def focus_window(d, name_pattern):
    """Focus and raise a window by name."""
    win = find_window(d, name_pattern)
    if not win:
        print(f'Window not found: {name_pattern}')
        return False

    root = d.screen().root
    atom_active = d.intern_atom('_NET_ACTIVE_WINDOW')

    # Send _NET_ACTIVE_WINDOW client message
    from Xlib import protocol
    event = protocol.event.ClientMessage(
        window=win,
        client_type=atom_active,
        data=(32, [2, X.CurrentTime, 0, 0, 0])
    )
    root.send_event(event, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
    d.sync()
    print(f'Focused window: {win.get_wm_name()}')
    return True


def screenshot_window(d, name_pattern, output='/tmp/gitslop-screenshot.png'):
    """Screenshot a specific window by name."""
    win = find_window(d, name_pattern)
    if not win:
        print(f'Window not found: {name_pattern}')
        return None

    # Get absolute position
    geo = win.get_geometry()
    coords = win.translate_coords(d.screen().root, 0, 0)
    abs_x = -coords.x
    abs_y = -coords.y

    # Screenshot from root at window position
    root = d.screen().root
    raw = root.get_image(abs_x, abs_y, geo.width, geo.height, X.ZPixmap, 0xffffffff)
    img = Image.frombytes('RGBX', (geo.width, geo.height), raw.data, 'raw', 'BGRX')
    img = img.convert('RGB')
    img.save(output)
    print(f'Window screenshot saved: {output} ({geo.width}x{geo.height})')
    return output


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    d = get_display()

    if cmd == 'screenshot':
        output = sys.argv[2] if len(sys.argv) > 2 else '/tmp/gitslop-screenshot.png'
        screenshot(d, output)

    elif cmd == 'click':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        click(d, x, y)

    elif cmd == 'doubleclick':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        double_click(d, x, y)

    elif cmd == 'rightclick':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        click(d, x, y, button=3)

    elif cmd == 'move':
        x, y = int(sys.argv[2]), int(sys.argv[3])
        move_mouse(d, x, y)

    elif cmd == 'type':
        text = ' '.join(sys.argv[2:])
        type_text(d, text)

    elif cmd == 'key':
        press_key(d, sys.argv[2])

    elif cmd == 'drag':
        x1, y1, x2, y2 = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
        drag(d, x1, y1, x2, y2)

    elif cmd == 'window-info':
        list_windows(d)

    elif cmd == 'focus':
        name = ' '.join(sys.argv[2:])
        focus_window(d, name)

    elif cmd == 'screenshot-window':
        name = sys.argv[2]
        output = sys.argv[3] if len(sys.argv) > 3 else '/tmp/gitslop-screenshot.png'
        screenshot_window(d, name, output)

    else:
        print(f'Unknown command: {cmd}')
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
