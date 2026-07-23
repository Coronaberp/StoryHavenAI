/* @ds-bundle: {"format":4,"namespace":"StoryHavenAIDesignSystem_8e6189","components":[{"name":"ChatBubble","sourcePath":"components/chat/ChatBubble.jsx"},{"name":"Composer","sourcePath":"components/chat/Composer.jsx"},{"name":"CharacterCard","sourcePath":"components/content/CharacterCard.jsx"},{"name":"Eyebrow","sourcePath":"components/content/Eyebrow.jsx"},{"name":"ModeBadge","sourcePath":"components/content/ModeBadge.jsx"},{"name":"StatPill","sourcePath":"components/content/StatPill.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Modal","sourcePath":"components/feedback/Modal.jsx"},{"name":"SearchField","sourcePath":"components/forms/SearchField.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"TextField","sourcePath":"components/forms/TextField.jsx"}],"sourceHashes":{"components/chat/ChatBubble.jsx":"deb8f3c3a44e","components/chat/Composer.jsx":"efad606baf8c","components/content/CharacterCard.jsx":"5e9d15803609","components/content/Eyebrow.jsx":"eb0d5f285e6e","components/content/ModeBadge.jsx":"85e4a0acdf7e","components/content/StatPill.jsx":"82c52fc9af35","components/core/Badge.jsx":"8491ef192095","components/core/Button.jsx":"b4269df37d00","components/core/Chip.jsx":"4333773b0fdd","components/core/IconButton.jsx":"54b01f904c9f","components/core/Tag.jsx":"07c1dbe95577","components/feedback/Modal.jsx":"1abec8d35457","components/forms/SearchField.jsx":"398ecad838c3","components/forms/Select.jsx":"dc595e36c00a","components/forms/Switch.jsx":"a74a0040e415","components/forms/TextField.jsx":"9ed7ce4f1968","ui_kits/storyhaven-app/ChatScreen.jsx":"8e5791774337","ui_kits/storyhaven-app/DossierScreen.jsx":"8a3fe6f9d11a","ui_kits/storyhaven-app/LibraryScreen.jsx":"28552b0599f7","ui_kits/storyhaven-app/LoginScreen.jsx":"d72de39449af","ui_kits/storyhaven-app/Sidebar.jsx":"981d2f250a13","ui_kits/storyhaven-app/app.jsx":"a82d93063962","ui_kits/storyhaven-app/data.jsx":"9db4290c883d","ui_kits/storyhaven-app/icons.jsx":"48957b23ec01"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.StoryHavenAIDesignSystem_8e6189 = window.StoryHavenAIDesignSystem_8e6189 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/chat/ChatBubble.jsx
try { (() => {
/**
 * StoryHaven AI — ChatBubble
 * A single conversation turn. The user turn is a gold-tinted bubble aligned
 * right; the AI turn is borderless prose with a mono name kicker, aligned to
 * the reading column. Mirrors `.turn.you` / `.turn.ai` (profile.css).
 */
function ChatBubble({
  role = 'ai',
  name,
  children,
  style = {}
}) {
  if (role === 'you') {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '26px',
        ...style
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--mono)',
        fontSize: '11px',
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        textAlign: 'right',
        marginBottom: '7px'
      }
    }, name || 'You'), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 'fit-content',
        maxWidth: '82%',
        marginLeft: 'auto',
        background: 'color-mix(in srgb, var(--accent) 20%, var(--surface-2))',
        border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
        borderRadius: '14px 14px 4px 14px',
        padding: '11px 15px',
        fontSize: '15px',
        lineHeight: 1.6,
        color: 'var(--ink)'
      }
    }, children));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '26px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '11px',
      letterSpacing: '.14em',
      textTransform: 'uppercase',
      color: 'var(--accent)',
      marginBottom: '7px'
    }
  }, name || 'Character'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '16.5px',
      lineHeight: 1.75,
      color: 'var(--ink)'
    }
  }, children));
}
Object.assign(__ds_scope, { ChatBubble });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/ChatBubble.jsx", error: String((e && e.message) || e) }); }

// components/chat/Composer.jsx
try { (() => {
/**
 * StoryHaven AI — Composer
 * The chat input bar: a rounded surface field that grows on focus, with a
 * gold gradient send button. Mirrors `.composer` (overlay.css).
 */
function Composer({
  placeholder = 'Write your reply…',
  value,
  onChange,
  onSend,
  sending = false,
  style = {}
}) {
  const [focus, setFocus] = React.useState(false);
  const [local, setLocal] = React.useState('');
  const val = value != null ? value : local;
  const handle = e => {
    onChange ? onChange(e) : setLocal(e.target.value);
  };
  const send = () => {
    if (onSend) onSend(val);
    if (value == null) setLocal('');
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--line)',
      background: 'var(--surface-2)',
      padding: '14px 26px 18px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '720px',
      margin: '0 auto',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-end',
      background: 'var(--surface)',
      border: `1px solid ${focus ? 'var(--accent)' : 'var(--line)'}`,
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      borderRadius: '16px',
      padding: '8px 8px 8px 16px',
      transition: 'var(--dur)'
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    rows: 1,
    value: val,
    placeholder: placeholder,
    onChange: handle,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onKeyDown: e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      resize: 'none',
      fontFamily: 'var(--sans)',
      fontSize: '16px',
      lineHeight: 1.5,
      maxHeight: '170px',
      background: 'none',
      color: 'var(--ink)',
      padding: '6px 0'
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: send,
    disabled: sending,
    "aria-label": "Send",
    style: {
      flex: 'none',
      width: '50px',
      height: '50px',
      borderRadius: '13px',
      border: 'none',
      background: sending ? 'var(--warn)' : 'linear-gradient(135deg, var(--violet), var(--violet-deep))',
      color: sending ? '#fff' : 'var(--gold-ink)',
      fontSize: '20px',
      transition: 'var(--dur)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, sending ? '■' : /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("line", {
    x1: "22",
    y1: "2",
    x2: "11",
    y2: "13"
  }), /*#__PURE__*/React.createElement("polygon", {
    points: "22 2 15 22 11 13 2 9 22 2"
  })))));
}
Object.assign(__ds_scope, { Composer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/Composer.jsx", error: String((e && e.message) || e) }); }

// components/content/Eyebrow.jsx
try { (() => {
/**
 * StoryHaven AI — Eyebrow
 * The brand's signature mono, uppercase, wide-tracked kicker above a heading.
 * Mirrors `.page-eyebrow` (base.css).
 */
function Eyebrow({
  tone = 'accent',
  style = {},
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '11px',
      letterSpacing: '.2em',
      textTransform: 'uppercase',
      color: tone === 'muted' ? 'var(--muted)' : 'var(--accent)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/content/ModeBadge.jsx
try { (() => {
/**
 * StoryHaven AI — ModeBadge
 * The character mode badge shown in chat header / on cards. Mirrors `.mode-badge`.
 */
function ModeBadge({
  mode = 'character',
  style = {},
  children
}) {
  const rpg = mode === 'rpg';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '9.5px',
      letterSpacing: '.12em',
      textTransform: 'uppercase',
      padding: '3px 8px',
      borderRadius: '6px',
      border: `1px solid ${rpg ? 'transparent' : 'var(--line-2)'}`,
      color: rpg ? 'var(--accent-deep)' : 'var(--muted)',
      background: rpg ? 'var(--accent-soft)' : 'transparent',
      flex: 'none',
      display: 'inline-block',
      ...style
    }
  }, children || (rpg ? 'RPG · GM' : 'Character'));
}
Object.assign(__ds_scope, { ModeBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/ModeBadge.jsx", error: String((e && e.message) || e) }); }

// components/content/StatPill.jsx
try { (() => {
/**
 * StoryHaven AI — StatPill
 * A rounded stat pill: label with an emphasized value. Mirrors `.doss-stat`.
 */
function StatPill({
  value,
  label,
  style = {},
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '4px 10px',
      border: '1px solid var(--line)',
      borderRadius: '20px',
      background: 'var(--accent-tint)',
      color: 'var(--sec)',
      fontSize: '11.5px',
      fontWeight: 600,
      ...style
    }
  }, value != null && /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--ink)',
      fontWeight: 700
    }
  }, value), label, children);
}
Object.assign(__ds_scope, { StatPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/StatPill.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — Badge
 * Mono, uppercase, wide-tracked status chip. Mirrors `.badge` (overlay.css).
 */
function Badge({
  variant = 'key',
  style = {},
  children,
  ...rest
}) {
  const variants = {
    always: {
      background: 'var(--accent)',
      color: 'var(--gold-ink)'
    },
    key: {
      background: 'var(--accent-tint)',
      color: 'var(--accent-deep)',
      border: '1px solid var(--line)'
    },
    global: {
      background: 'var(--warn-soft)',
      color: 'var(--warn)',
      border: '1px solid var(--warn-soft)'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '10px',
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      padding: '2px 8px',
      borderRadius: '6px',
      display: 'inline-block',
      lineHeight: 1.5,
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — Button
 * Mirrors the product's `.btn` family (static/css/profile.css).
 */
function Button({
  variant = 'default',
  size = 'md',
  active = false,
  icon = null,
  iconRight = null,
  disabled = false,
  type = 'button',
  onClick,
  style = {},
  children,
  ...rest
}) {
  const pad = size === 'sm' ? '9px 14px' : size === 'lg' ? '14px 24px' : '12px 20px';
  const fs = size === 'sm' ? '13.5px' : '15px';
  const base = {
    border: '1px solid var(--line-2)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    borderRadius: 'var(--r)',
    padding: pad,
    fontSize: fs,
    fontWeight: 500,
    lineHeight: 1.2,
    fontFamily: 'var(--sans)',
    transition: 'var(--dur)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    outline: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    whiteSpace: 'nowrap'
  };
  const variants = {
    default: {},
    primary: {
      background: 'linear-gradient(135deg, var(--violet), var(--violet-deep))',
      color: 'var(--gold-ink)',
      borderColor: 'transparent',
      fontWeight: 600
    },
    danger: {},
    stop: {
      background: 'var(--warn)',
      color: '#fff',
      borderColor: 'transparent',
      fontWeight: 600
    },
    ghost: {
      background: 'none',
      borderColor: 'transparent'
    }
  };
  const activeStyle = active ? {
    background: 'var(--accent-soft)',
    borderColor: 'var(--accent)',
    color: 'var(--accent-deep)'
  } : {};
  const [hover, setHover] = React.useState(false);
  const hoverStyle = hover && !disabled ? hoverFor(variant) : {};
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...base,
      ...variants[variant],
      ...activeStyle,
      ...hoverStyle,
      ...style
    }
  }, rest), icon, children, iconRight);
}
function hoverFor(variant) {
  switch (variant) {
    case 'primary':
      return {
        boxShadow: '0 0 0 1px var(--accent), 0 8px 20px -8px var(--violet)',
        color: 'var(--gold-ink)'
      };
    case 'danger':
      return {
        borderColor: 'var(--warn)',
        color: 'var(--warn)'
      };
    case 'stop':
      return {
        boxShadow: '0 0 0 1px var(--warn)',
        color: '#fff'
      };
    default:
      return {
        borderColor: 'var(--accent)',
        color: 'var(--accent)'
      };
  }
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — Chip
 * Mono macro/insert chip. Mirrors `.chip` (overlay.css).
 */
function Chip({
  onClick,
  style = {},
  children,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '11px',
      background: 'var(--surface-2)',
      border: `1px solid ${hover ? 'var(--accent)' : 'var(--line)'}`,
      borderRadius: '7px',
      padding: '4px 10px',
      color: hover ? 'var(--accent)' : 'var(--sec)',
      cursor: 'pointer',
      transition: 'var(--dur)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — IconButton
 * Square icon-only button, mirrors `.rail-icon-btn` (static/css/base.css).
 */
function IconButton({
  active = false,
  size = 34,
  title,
  ariaLabel,
  disabled = false,
  onClick,
  style = {},
  children,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const on = active || hover && !disabled;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    title: title,
    "aria-label": ariaLabel || title,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: size,
      height: size,
      flex: 'none',
      padding: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '8px',
      background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
      border: `1px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`,
      color: on ? 'var(--accent)' : 'var(--sec)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'var(--dur)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — Tag
 * Rounded pill for content labels/genres. Mirrors `.tag` (profile.css).
 */
function Tag({
  variant = 'default',
  size = 'md',
  style = {},
  children,
  ...rest
}) {
  const gold = variant === 'gold';
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-block',
      fontSize: size === 'sm' ? '10px' : '11.5px',
      fontWeight: gold ? 700 : 500,
      color: gold ? 'var(--accent)' : 'var(--sec)',
      background: 'var(--accent-tint)',
      border: `1px solid ${gold ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--line)'}`,
      borderRadius: '20px',
      padding: size === 'sm' ? '1px 7px' : '2px 9px',
      letterSpacing: gold ? '.03em' : 0,
      textTransform: gold ? 'uppercase' : 'none',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/content/CharacterCard.jsx
try { (() => {
/**
 * StoryHaven AI — CharacterCard
 * The 3:4 catalog card with a gradient border, full-bleed art, bottom fade,
 * and title/tagline/tags overlaid. Mirrors `.card-entry` (profile.css).
 */
function CharacterCard({
  name,
  tagline,
  image,
  author,
  chats,
  tags = [],
  mono,
  onClick,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'relative',
      aspectRatio: '3 / 4',
      border: '1.5px solid transparent',
      borderRadius: '12px',
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'var(--dur)',
      transform: hover ? 'translateY(-1px)' : 'none',
      boxShadow: hover ? 'var(--shadow-hover)' : 'none',
      backgroundImage: 'linear-gradient(var(--surface-2), var(--surface-2)), linear-gradient(150deg, var(--accent) 0%, #000 100%)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0
    }
  }, image ? /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: "",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'grid',
      placeItems: 'center',
      fontSize: 44,
      color: 'var(--accent)',
      fontFamily: 'var(--display)',
      background: 'linear-gradient(155deg, color-mix(in srgb, var(--accent) 22%, var(--surface-2)), var(--surface-2))'
    }
  }, mono || (name ? name[0] : '❖'))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(0deg, #0C0C0E 0%, transparent 55%)',
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: '10px 11px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: '14.5px',
      fontWeight: 700,
      margin: 0,
      letterSpacing: '-.01em',
      color: 'var(--accent-deep)',
      textShadow: '0 1px 3px rgba(0,0,0,.85)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, name), tagline && /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--accent)',
      opacity: .9,
      fontSize: '12px',
      margin: 0,
      textShadow: '0 1px 3px rgba(0,0,0,.85)',
      lineHeight: 1.4,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden'
    }
  }, tagline), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'nowrap',
      alignItems: 'center',
      gap: '6px',
      overflow: 'hidden'
    }
  }, chats != null && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 'none',
      color: '#fff',
      textShadow: '0 1px 3px rgba(0,0,0,.85)',
      fontSize: '11px'
    }
  }, "\u25F7 ", chats), tags.slice(0, 2).map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      flex: '0 1 auto',
      minWidth: 0,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      textTransform: 'uppercase',
      fontSize: '9px',
      padding: '1px 6px',
      borderRadius: '20px',
      background: 'rgba(0,0,0,.55)',
      border: '1px solid rgba(255,255,255,.22)',
      color: '#fff',
      backdropFilter: 'blur(2px)',
      marginLeft: chats != null ? 'auto' : 0
    }
  }, t))), author && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '10px',
      color: 'var(--accent)',
      opacity: .75,
      textShadow: '0 1px 2px rgba(0,0,0,.6)'
    }
  }, "by ", author)));
}
Object.assign(__ds_scope, { CharacterCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/CharacterCard.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Modal.jsx
try { (() => {
/**
 * StoryHaven AI — Modal
 * A centered dialog over a blurred scrim, with a serif title, a "Close" pill,
 * and a sticky footer action row. Mirrors `.scrim` / `.modal` (overlay.css).
 */
function Modal({
  open = true,
  title,
  onClose,
  footer,
  wide = false,
  children,
  style = {}
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      background: '#000000b3',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      position: 'relative',
      background: 'var(--paper)',
      border: '1px solid var(--line-2)',
      borderRadius: '16px',
      maxWidth: wide ? 'min(1100px, 92vw)' : '560px',
      width: '100%',
      maxHeight: '86vh',
      overflowY: 'auto',
      padding: '26px 28px',
      boxShadow: 'var(--shadow-modal)',
      ...style
    }
  }, onClose && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Close",
    style: {
      position: 'absolute',
      top: '20px',
      right: '20px',
      background: 'var(--surface)',
      border: '1px solid var(--line-2)',
      color: 'var(--sec)',
      borderRadius: '20px',
      padding: '6px 14px',
      fontSize: '13px',
      cursor: 'pointer'
    }
  }, "Close"), title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 18px',
      fontSize: '20px',
      fontWeight: 600,
      fontFamily: 'var(--display)',
      letterSpacing: '-.01em',
      color: 'var(--ink)'
    }
  }, title), /*#__PURE__*/React.createElement("div", null, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      justifyContent: 'flex-end',
      marginTop: '20px'
    }
  }, footer)));
}
Modal.Button = __ds_scope.Button;
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Modal.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — SearchField
 * Pill search input with a leading glyph. Mirrors `.search` (base.css).
 */
function SearchField({
  value,
  defaultValue,
  placeholder = 'Search…',
  onChange,
  style = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      background: 'var(--surface)',
      border: `1px solid ${focus ? 'var(--accent)' : 'var(--line)'}`,
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      borderRadius: 'var(--r)',
      padding: '9px 13px',
      transition: 'var(--dur)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--muted)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "21",
    y1: "21",
    x2: "16.65",
    y2: "16.65"
  })), /*#__PURE__*/React.createElement("input", _extends({
    type: "text",
    value: value,
    defaultValue: defaultValue,
    placeholder: placeholder,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      border: 'none',
      outline: 'none',
      background: 'none',
      flex: 1,
      fontFamily: 'var(--sans)',
      fontSize: '14.5px',
      color: 'var(--ink)',
      minWidth: 0
    }
  }, rest)));
}
Object.assign(__ds_scope, { SearchField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchField.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — Select
 * Native select styled to match, with the gold chevron. Mirrors `.field select`.
 */
function Select({
  label,
  value,
  defaultValue,
  onChange,
  options = [],
  disabled = false,
  style = {},
  children,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const chevron = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1L6 6L11 1' stroke='%23968B7A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '20px',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, label), /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      background: 'var(--surface)',
      border: `1px solid ${focus ? 'var(--accent)' : 'var(--line)'}`,
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      borderRadius: '9px',
      padding: '11px 36px 11px 13px',
      fontFamily: 'var(--sans)',
      fontSize: '15px',
      color: 'var(--ink)',
      outline: 'none',
      transition: 'var(--dur)',
      appearance: 'none',
      WebkitAppearance: 'none',
      cursor: 'pointer',
      backgroundImage: `url("${chevron}")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 13px center'
    }
  }, rest), options.map(o => typeof o === 'string' ? /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)), children));
}
const labelStyle = {
  display: 'block',
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: 'var(--sec)',
  marginBottom: '7px'
};
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — Switch (checkbox row)
 * A labelled toggle row with optional hint. Mirrors `.switch` (overlay.css).
 */
function Switch({
  label,
  hint,
  checked,
  defaultChecked,
  onChange,
  nsfw = false,
  disabled = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: '4px 10px',
      marginBottom: '16px',
      fontSize: '14px',
      color: 'var(--sec)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...(nsfw ? {
        background: 'var(--warn-bg)',
        border: '1px solid var(--warn-soft)',
        borderRadius: '10px',
        padding: '12px 14px'
      } : {}),
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled,
    style: {
      width: nsfw ? 18 : 16,
      height: nsfw ? 18 : 16,
      accentColor: nsfw ? 'var(--warn)' : 'var(--accent)',
      flex: 'none',
      marginTop: '2px'
    }
  }, rest)), /*#__PURE__*/React.createElement("span", null, label), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      flexBasis: '100%',
      marginLeft: '26px',
      fontFamily: 'var(--sans)',
      fontSize: '12.5px',
      color: nsfw ? 'var(--sec)' : 'var(--muted)',
      fontWeight: 400
    }
  }, hint));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StoryHaven AI — TextField
 * Labelled text input / textarea. Mirrors `.field` + input/textarea (overlay.css).
 */
function TextField({
  label,
  multiline = false,
  rows = 4,
  value,
  defaultValue,
  placeholder,
  hint,
  counter,
  disabled = false,
  onChange,
  style = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const controlStyle = {
    width: '100%',
    background: 'var(--surface)',
    border: `1px solid ${focus ? 'var(--accent)' : 'var(--line)'}`,
    boxShadow: focus ? 'var(--focus-ring)' : 'none',
    borderRadius: '9px',
    padding: '11px 13px',
    fontFamily: 'var(--sans)',
    fontSize: '15px',
    color: 'var(--ink)',
    outline: 'none',
    transition: 'var(--dur)',
    resize: multiline ? 'vertical' : undefined,
    minHeight: multiline ? '90px' : undefined,
    lineHeight: multiline ? 1.55 : undefined
  };
  const Control = multiline ? 'textarea' : 'input';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '20px',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, label, counter != null && /*#__PURE__*/React.createElement("span", {
    style: counterStyle
  }, counter)), /*#__PURE__*/React.createElement(Control, _extends({}, multiline ? {
    rows
  } : {
    type: 'text'
  }, {
    value: value,
    defaultValue: defaultValue,
    placeholder: placeholder,
    disabled: disabled,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: controlStyle
  }, rest)), hint && /*#__PURE__*/React.createElement("div", {
    style: hintStyle
  }, hint));
}
const labelStyle = {
  display: 'block',
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: 'var(--sec)',
  marginBottom: '7px'
};
const counterStyle = {
  float: 'right',
  fontFamily: 'var(--mono)',
  fontSize: '10.5px',
  color: 'var(--muted)',
  letterSpacing: 0
};
const hintStyle = {
  fontFamily: 'var(--sans)',
  fontSize: '12.5px',
  color: 'var(--muted)',
  marginTop: '6px'
};
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextField.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/ChatScreen.jsx
try { (() => {
/* StoryHaven AI — chat screen (header + thread + composer). */
function ChatScreen({
  character,
  onBack
}) {
  const {
    ChatBubble,
    Composer,
    ModeBadge,
    IconButton
  } = window.StoryHavenAIDesignSystem_8e6189;
  const I = window.SHIcons;
  const c = character;
  const [turns, setTurns] = React.useState([{
    role: 'ai',
    name: c.name,
    text: c.greeting
  }]);
  const [thinking, setThinking] = React.useState(false);
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, thinking]);
  const send = text => {
    if (!text || !text.trim()) return;
    setTurns(t => [...t, {
      role: 'you',
      name: 'Kael',
      text
    }]);
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setTurns(t => [...t, {
        role: 'ai',
        name: c.name,
        text: reply(c, text)
      }]);
    }, 1100);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: cs.shell
  }, /*#__PURE__*/React.createElement("div", {
    style: cs.top
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onBack,
    style: cs.backBtn,
    title: "Back"
  }, /*#__PURE__*/React.createElement(I.Back, {
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: cs.ava
  }, c.mono), /*#__PURE__*/React.createElement("div", {
    style: cs.who
  }, /*#__PURE__*/React.createElement("div", {
    style: cs.name
  }, c.name), /*#__PURE__*/React.createElement("div", {
    style: cs.status
  }, "Session \xB7 memory on")), /*#__PURE__*/React.createElement(ModeBadge, {
    mode: c.mode
  }), /*#__PURE__*/React.createElement("div", {
    style: cs.actions
  }, /*#__PURE__*/React.createElement(IconButton, {
    title: "Thinking"
  }, /*#__PURE__*/React.createElement(I.Brain, null)), /*#__PURE__*/React.createElement(IconButton, {
    title: "Generate image"
  }, /*#__PURE__*/React.createElement(I.Image, null)), /*#__PURE__*/React.createElement(IconButton, {
    title: "Memory"
  }, /*#__PURE__*/React.createElement(I.Memory, null)))), /*#__PURE__*/React.createElement("div", {
    ref: scrollRef,
    style: cs.scroll
  }, /*#__PURE__*/React.createElement("div", {
    style: cs.thread
  }, turns.map((t, i) => /*#__PURE__*/React.createElement(ChatBubble, {
    key: i,
    role: t.role,
    name: t.name
  }, /*#__PURE__*/React.createElement("span", {
    dangerouslySetInnerHTML: {
      __html: window.mdLite ? window.mdLite(t.text) : t.text
    }
  }))), thinking && /*#__PURE__*/React.createElement("div", {
    style: cs.thinkRow
  }, /*#__PURE__*/React.createElement("span", {
    style: cs.pulse
  }), c.name, " is writing\u2026"))), c.mode === 'rpg' && /*#__PURE__*/React.createElement("div", {
    style: cs.diceTray
  }, /*#__PURE__*/React.createElement("span", {
    style: cs.diceLabel
  }, "Roll"), ['d4', 'd6', 'd8', 'd20', '2d6'].map(d => /*#__PURE__*/React.createElement("button", {
    key: d,
    style: cs.die,
    onClick: () => send('/roll ' + d)
  }, d))), /*#__PURE__*/React.createElement(Composer, {
    placeholder: c.mode === 'rpg' ? 'Describe your action…' : 'Write your reply…',
    onSend: send,
    sending: thinking
  }));
}
function reply(c, text) {
  if (text.startsWith('/roll')) {
    const n = 1 + Math.floor(Math.random() * 20);
    return `\uD83C\uDFB2 ${text.replace('/roll', '').trim() || 'd20'} \u2192 **${n}**. *The dice settle.* The Warden weighs the result, and the scene shifts.`;
  }
  if (c.mode === 'rpg') return '*The narrator considers your move.* The forest answers first — a branch snaps, closer than before. **Roll for perception.**';
  return '*She sets down the ledger at last, studying you.* \u201CThen you\u2019ll want to hear what the archive turned up. Sit. This part matters.\u201D';
}
const cs = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%'
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 22px',
    borderBottom: '1px solid var(--line)',
    background: 'var(--surface-2)',
    flex: 'none'
  },
  backBtn: {
    color: 'var(--sec)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center'
  },
  ava: {
    width: 38,
    height: 38,
    borderRadius: 9,
    display: 'grid',
    placeItems: 'center',
    fontSize: 18,
    color: 'var(--accent)',
    background: 'var(--surface)',
    border: '1px solid var(--line-2)',
    fontFamily: 'var(--display)',
    flex: 'none'
  },
  who: {
    flex: 1,
    minWidth: 0
  },
  name: {
    fontFamily: 'var(--display)',
    fontWeight: 600,
    fontSize: 16,
    color: 'var(--ink)'
  },
  status: {
    fontSize: 12,
    color: 'var(--muted)'
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    position: 'relative'
  },
  thread: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '30px 26px 10px'
  },
  thinkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'var(--mono)',
    fontSize: 11,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    marginBottom: 20
  },
  pulse: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'var(--accent)',
    animation: 'blink 1s steps(2) infinite'
  },
  diceTray: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 26px',
    borderTop: '1px solid var(--line)',
    background: 'var(--surface-2)',
    maxWidth: 720,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box'
  },
  diceLabel: {
    fontFamily: 'var(--mono)',
    fontSize: 10.5,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    marginRight: 4
  },
  die: {
    border: '1px solid var(--line-2)',
    background: 'var(--surface)',
    color: 'var(--sec)',
    borderRadius: 8,
    padding: '6px 12px',
    fontFamily: 'var(--mono)',
    fontSize: 13,
    cursor: 'pointer'
  }
};
window.ChatScreen = ChatScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/ChatScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/DossierScreen.jsx
try { (() => {
/* StoryHaven AI — character dossier (hero + floating card + lore). */
function DossierScreen({
  character,
  onBack,
  onStartChat
}) {
  const {
    Button,
    Tag,
    StatPill,
    ModeBadge,
    Badge,
    IconButton
  } = window.StoryHavenAIDesignSystem_8e6189;
  const I = window.SHIcons;
  const c = character;
  const lore = [{
    scope: 'always',
    title: 'The Sunken Archive',
    body: 'A vaulted library beneath the west spire, flooded to the second tier. Aria keeps its only dry ledger.'
  }, {
    scope: 'key',
    title: 'The Cartographer\u2019s Debt',
    body: 'Aria owes a map-maker named Ostry a favor she is very reluctant to name.'
  }, {
    scope: 'key',
    title: 'Moonglass',
    body: 'A pale, faintly luminous mineral. Aria will trade almost anything for an unbroken shard.'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: ds.wrap
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onBack,
    style: ds.back
  }, /*#__PURE__*/React.createElement(I.Back, {
    size: 13
  }), " Back to library"), /*#__PURE__*/React.createElement("div", {
    style: ds.hero
  }, /*#__PURE__*/React.createElement("div", {
    style: ds.heroFade
  })), /*#__PURE__*/React.createElement("div", {
    style: ds.card
  }, /*#__PURE__*/React.createElement("div", {
    style: ds.cardAva
  }, c.mono), /*#__PURE__*/React.createElement("div", {
    style: ds.cardBody
  }, /*#__PURE__*/React.createElement("div", {
    style: ds.call
  }, "Character dossier"), /*#__PURE__*/React.createElement("div", {
    style: ds.cardRow
  }, /*#__PURE__*/React.createElement("h1", {
    style: ds.h1
  }, c.name), /*#__PURE__*/React.createElement(ModeBadge, {
    mode: c.mode
  })), /*#__PURE__*/React.createElement("div", {
    style: ds.meta
  }, c.tags.map(t => /*#__PURE__*/React.createElement(Tag, {
    key: t,
    variant: "gold",
    size: "sm"
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: ds.stats
  }, /*#__PURE__*/React.createElement(StatPill, {
    value: c.chats,
    label: "chats"
  }), /*#__PURE__*/React.createElement(StatPill, {
    value: c.lore,
    label: "lore entries"
  }), /*#__PURE__*/React.createElement(StatPill, {
    value: c.images,
    label: "images"
  })), /*#__PURE__*/React.createElement("p", {
    style: ds.desc
  }, c.tagline, " Built with a per-character lorebook and session-scoped memory, so every conversation remembers what matters \u2014 and forgets what doesn't."))), /*#__PURE__*/React.createElement("div", {
    style: ds.actions
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => onStartChat(c)
  }, "Start chat"), /*#__PURE__*/React.createElement(Button, null, "Edit"), /*#__PURE__*/React.createElement(Button, {
    icon: /*#__PURE__*/React.createElement(I.Image, null)
  }, "Gallery"), /*#__PURE__*/React.createElement(Button, null, "Export card"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    title: "Memory"
  }, /*#__PURE__*/React.createElement(I.Memory, null)))), /*#__PURE__*/React.createElement("div", {
    style: ds.layout
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: ds.sectionHead
  }, "First message"), /*#__PURE__*/React.createElement("div", {
    style: ds.greeting,
    dangerouslySetInnerHTML: {
      __html: mdLite(c.greeting)
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      ...ds.sectionHead,
      marginTop: 30
    }
  }, "Lorebook ", /*#__PURE__*/React.createElement("span", {
    style: ds.count
  }, c.lore, " entries")), lore.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: ds.loreEntry
  }, /*#__PURE__*/React.createElement("div", {
    style: ds.loreTop
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: l.scope
  }, l.scope), /*#__PURE__*/React.createElement("b", {
    style: ds.loreTitle
  }, l.title)), /*#__PURE__*/React.createElement("div", {
    style: ds.loreBody
  }, l.body)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: ds.sideCard
  }, /*#__PURE__*/React.createElement("div", {
    style: ds.sideLabel
  }, "Mode"), /*#__PURE__*/React.createElement("p", {
    style: ds.sideText
  }, c.mode === 'rpg' ? 'RPG · Game Master — an impartial narrator builds the world, runs NPCs, and calls for dice.' : 'Character — first-person roleplay. The model is the character and speaks with you directly.'), /*#__PURE__*/React.createElement("div", {
    style: {
      ...ds.sideLabel,
      marginTop: 16
    }
  }, "Created by"), /*#__PURE__*/React.createElement("p", {
    style: ds.sideText
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)',
      fontFamily: 'var(--mono)'
    }
  }, "@", c.author))))));
}

/* tiny markdown-lite: *em* and **strong**, used only for demo greeting text */
function mdLite(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--ink);font-weight:600">$1</strong>').replace(/\*(.+?)\*/g, '<em style="color:var(--sec);font-style:italic">$1</em>');
}
const ds = {
  wrap: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    padding: '24px 26px 60px'
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
    color: 'var(--sec)',
    fontSize: 13,
    cursor: 'pointer'
  },
  hero: {
    position: 'relative',
    height: 190,
    borderRadius: 16,
    overflow: 'hidden',
    border: '1px solid var(--line)',
    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, var(--surface-2)), var(--surface-2))'
  },
  heroFade: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(180deg, transparent 35%, var(--paper) 100%)'
  },
  card: {
    position: 'relative',
    margin: '-40px 12px 0',
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    padding: '16px 18px',
    display: 'flex',
    gap: 16,
    alignItems: 'flex-start',
    boxShadow: '0 14px 32px -16px rgba(0,0,0,.5)'
  },
  cardAva: {
    width: 72,
    height: 72,
    borderRadius: 12,
    flex: 'none',
    border: '2px solid var(--accent)',
    background: 'var(--surface)',
    boxShadow: '0 0 0 3px var(--surface-2)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 30,
    color: 'var(--accent)',
    fontFamily: 'var(--display)'
  },
  cardBody: {
    flex: 1,
    minWidth: 0
  },
  call: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--accent)',
    letterSpacing: '.06em',
    textTransform: 'uppercase'
  },
  cardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 2
  },
  h1: {
    fontFamily: 'var(--display)',
    fontSize: 24,
    fontWeight: 600,
    margin: 0,
    letterSpacing: '-.01em',
    color: 'var(--ink)'
  },
  meta: {
    marginTop: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6
  },
  stats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12
  },
  desc: {
    marginTop: 12,
    fontSize: 14,
    color: 'var(--sec)',
    lineHeight: 1.55
  },
  actions: {
    display: 'flex',
    gap: 9,
    margin: '20px 0 30px',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '1fr 300px',
    gap: 24,
    alignItems: 'start'
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontFamily: 'var(--mono)',
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    borderBottom: '1px solid var(--line)',
    paddingBottom: 8,
    marginBottom: 12
  },
  count: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--accent)',
    background: 'var(--accent-tint)',
    padding: '3px 9px',
    borderRadius: 20,
    marginLeft: 'auto',
    letterSpacing: 0
  },
  greeting: {
    fontSize: 15.5,
    color: 'var(--ink)',
    lineHeight: 1.7
  },
  loreEntry: {
    border: '1px solid var(--line)',
    borderRadius: 11,
    padding: '13px 15px',
    marginBottom: 12,
    background: 'var(--surface)'
  },
  loreTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    marginBottom: 8
  },
  loreTitle: {
    fontFamily: 'var(--display)',
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--ink)'
  },
  loreBody: {
    fontSize: 14,
    color: 'var(--sec)',
    lineHeight: 1.5
  },
  sideCard: {
    border: '1px solid var(--line)',
    borderRadius: 14,
    padding: 18,
    background: 'var(--surface-2)'
  },
  sideLabel: {
    fontFamily: 'var(--mono)',
    fontSize: 10.5,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    marginBottom: 6
  },
  sideText: {
    fontSize: 13.5,
    color: 'var(--sec)',
    lineHeight: 1.55,
    margin: 0
  }
};
window.DossierScreen = DossierScreen;
window.mdLite = mdLite;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/DossierScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/LibraryScreen.jsx
try { (() => {
/* StoryHaven AI — Library (character catalog) screen. */
const CharacterTile = window.CharacterTile;
function LibraryScreen({
  onOpen
}) {
  const {
    SearchField,
    Button,
    Eyebrow
  } = window.StoryHavenAIDesignSystem_8e6189;
  const [filter, setFilter] = React.useState('All');
  const chars = window.SHData.characters;
  const filters = ['All', 'Character', 'RPG', 'Fantasy', 'Sci-fi', 'Cozy'];
  const shown = chars.filter(c => {
    if (filter === 'All') return true;
    if (filter === 'Character' || filter === 'RPG') return c.mode === filter.toLowerCase();
    return c.tags.includes(filter);
  });
  return /*#__PURE__*/React.createElement("div", {
    style: lib.wrap
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "Your library"), /*#__PURE__*/React.createElement("h1", {
    style: lib.h1
  }, "Characters"), /*#__PURE__*/React.createElement("p", {
    style: lib.sub
  }, "Every character you've created or imported. Pick one to pick up where you left off."), /*#__PURE__*/React.createElement("div", {
    style: lib.toolbar
  }, /*#__PURE__*/React.createElement(SearchField, {
    placeholder: "Search characters\u2026"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "New character")), /*#__PURE__*/React.createElement("div", {
    style: lib.pills
  }, filters.map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    onClick: () => setFilter(f),
    style: {
      ...lib.pill,
      ...(filter === f ? lib.pillOn : {})
    }
  }, f))), /*#__PURE__*/React.createElement("div", {
    style: lib.grid
  }, shown.map(c => /*#__PURE__*/React.createElement(CharacterTile, {
    key: c.id,
    c: c,
    onClick: () => onOpen(c)
  }))));
}
const lib = {
  wrap: {
    maxWidth: 1100,
    width: '100%',
    margin: '0 auto',
    padding: '30px 26px 60px'
  },
  h1: {
    fontFamily: 'var(--display)',
    fontWeight: 600,
    fontSize: 30,
    letterSpacing: '-.01em',
    margin: '4px 0 2px',
    color: 'var(--ink)'
  },
  sub: {
    color: 'var(--sec)',
    fontSize: 15,
    marginBottom: 22
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginBottom: 16
  },
  pills: {
    display: 'flex',
    gap: 8,
    marginBottom: 22,
    flexWrap: 'wrap'
  },
  pill: {
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    padding: '6px 16px',
    borderRadius: 999,
    fontFamily: 'var(--sans)',
    fontSize: 13,
    color: 'var(--muted)',
    cursor: 'pointer',
    transition: '.15s'
  },
  pillOn: {
    background: 'var(--accent)',
    color: 'var(--gold-ink)',
    borderColor: 'var(--accent)'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
    gap: 16
  }
};
window.LibraryScreen = LibraryScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/LibraryScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/LoginScreen.jsx
try { (() => {
/* StoryHaven AI — unauthenticated Explore / Login screen. */
function LoginScreen({
  onLogin
}) {
  const {
    Button,
    TextField
  } = window.StoryHavenAIDesignSystem_8e6189;
  const chars = window.SHData.characters;
  return /*#__PURE__*/React.createElement("div", {
    style: ls.root
  }, /*#__PURE__*/React.createElement("div", {
    style: ls.topbar
  }, /*#__PURE__*/React.createElement("div", {
    style: ls.brand
  }, /*#__PURE__*/React.createElement("span", {
    style: ls.glyph
  }, "\u2756"), /*#__PURE__*/React.createElement("span", {
    style: ls.bt
  }, /*#__PURE__*/React.createElement("span", {
    style: ls.name
  }, "StoryHaven AI"), /*#__PURE__*/React.createElement("span", {
    style: ls.tag
  }, "Forge worlds. Remember everything."))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    onClick: onLogin
  }, "Sign in")), /*#__PURE__*/React.createElement("div", {
    style: ls.hero
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-256.png",
    width: "148",
    height: "148",
    alt: "StoryHaven AI",
    style: ls.heroLogo
  }), /*#__PURE__*/React.createElement("div", {
    style: ls.eyebrow
  }, "Self-hosted AI roleplay"), /*#__PURE__*/React.createElement("h1", {
    style: ls.h1
  }, "A haven for every character you'll ever write."), /*#__PURE__*/React.createElement("p", {
    style: ls.sub
  }, "Dynamic lorebooks, unlimited semantic memory, and integrated image generation \u2014 running on your own hardware, with your data encrypted at rest. Import from the community card ecosystem and never lose a thread again."), /*#__PURE__*/React.createElement("div", {
    style: ls.cta
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: onLogin
  }, "Enter the library"), /*#__PURE__*/React.createElement(Button, {
    onClick: onLogin
  }, "Browse community"))), /*#__PURE__*/React.createElement("div", {
    style: ls.strip
  }, /*#__PURE__*/React.createElement("div", {
    style: ls.stripLabel
  }, "Featured this week"), /*#__PURE__*/React.createElement("div", {
    style: ls.grid
  }, chars.slice(0, 6).map(c => /*#__PURE__*/React.createElement(CharacterTile, {
    key: c.id,
    c: c,
    onClick: onLogin
  })))), /*#__PURE__*/React.createElement("div", {
    style: ls.footnote
  }, "You run the model. You own the data. No cloud lock-in."));
}

/* small local tile that reuses the DS CharacterCard */
function CharacterTile({
  c,
  onClick
}) {
  const {
    CharacterCard
  } = window.StoryHavenAIDesignSystem_8e6189;
  return /*#__PURE__*/React.createElement(CharacterCard, {
    name: c.name,
    tagline: c.tagline,
    author: c.author,
    chats: c.chats,
    tags: c.tags,
    mono: c.mono,
    onClick: onClick
  });
}
const ls = {
  root: {
    flex: 1,
    overflowY: 'auto',
    height: '100%'
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: '14px 26px',
    borderBottom: '1px solid var(--line)',
    position: 'sticky',
    top: 0,
    background: 'color-mix(in srgb, var(--paper) 92%, transparent)',
    backdropFilter: 'blur(6px)',
    zIndex: 5
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  glyph: {
    fontFamily: 'var(--display)',
    fontWeight: 600,
    fontSize: 22,
    background: 'linear-gradient(135deg,var(--accent),var(--violet-deep))',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent'
  },
  bt: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.1
  },
  name: {
    fontFamily: 'var(--display)',
    fontWeight: 600,
    letterSpacing: '.03em',
    fontSize: 16
  },
  tag: {
    fontSize: 10.5,
    fontStyle: 'italic',
    color: 'var(--muted)'
  },
  hero: {
    maxWidth: 760,
    margin: '0 auto',
    padding: '52px 26px 40px',
    textAlign: 'center'
  },
  heroLogo: {
    display: 'block',
    margin: '0 auto 18px',
    borderRadius: 20
  },
  eyebrow: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    letterSpacing: '.2em',
    textTransform: 'uppercase',
    color: 'var(--accent)'
  },
  h1: {
    fontFamily: 'var(--display)',
    fontWeight: 600,
    fontSize: 46,
    lineHeight: 1.08,
    letterSpacing: '-.02em',
    margin: '14px 0 18px',
    color: 'var(--ink)'
  },
  sub: {
    fontSize: 17,
    color: 'var(--sec)',
    lineHeight: 1.6,
    maxWidth: 620,
    margin: '0 auto 26px'
  },
  cta: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center'
  },
  strip: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '10px 26px 48px'
  },
  stripLabel: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    marginBottom: 16
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 16
  },
  footnote: {
    textAlign: 'center',
    fontStyle: 'italic',
    fontSize: 12.5,
    color: 'var(--muted)',
    padding: '14px 20px 30px'
  }
};
window.LoginScreen = LoginScreen;
window.CharacterTile = CharacterTile;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/Sidebar.jsx
try { (() => {
/* StoryHaven AI — app sidebar (the .rail). */
/* eslint-disable no-unused-vars */
function Sidebar({
  route,
  onNavigate,
  onNewCharacter,
  theme,
  onToggleTheme,
  recents = []
}) {
  const I = window.SHIcons;
  const {
    IconButton
  } = window.StoryHavenAIDesignSystem_8e6189;
  const items = [['library', 'Library', I.Library], ['community', 'Community', I.Community], ['personas', 'Personas', I.Personas], ['images', 'Creations', I.Creations], ['forum', 'Forum', I.Forum]];
  return /*#__PURE__*/React.createElement("aside", {
    style: sb.rail
  }, /*#__PURE__*/React.createElement("div", {
    style: sb.brand
  }, /*#__PURE__*/React.createElement("span", {
    style: sb.glyph
  }, "\u2756"), /*#__PURE__*/React.createElement("span", {
    style: sb.brandText
  }, /*#__PURE__*/React.createElement("span", {
    style: sb.brandName
  }, "StoryHaven AI"), /*#__PURE__*/React.createElement("span", {
    style: sb.tagline
  }, "Forge worlds. Remember everything."))), /*#__PURE__*/React.createElement("nav", {
    style: sb.nav
  }, items.map(([key, label, Icon]) => {
    const on = route === key;
    return /*#__PURE__*/React.createElement("a", {
      key: key,
      onClick: () => onNavigate(key),
      style: {
        ...sb.navA,
        ...(on ? sb.navAOn : {})
      },
      onMouseEnter: e => {
        if (!on) {
          e.currentTarget.style.background = 'var(--accent-tint)';
          e.currentTarget.style.color = 'var(--ink)';
        }
      },
      onMouseLeave: e => {
        if (!on) {
          e.currentTarget.style.background = 'none';
          e.currentTarget.style.color = 'var(--sec)';
        }
      }
    }, /*#__PURE__*/React.createElement(Icon, null), " ", /*#__PURE__*/React.createElement("span", null, label));
  }), /*#__PURE__*/React.createElement("a", {
    onClick: onNewCharacter,
    style: sb.navNew
  }, /*#__PURE__*/React.createElement(I.Plus, null), " ", /*#__PURE__*/React.createElement("span", null, "New character"))), /*#__PURE__*/React.createElement("div", {
    style: sb.railLabel
  }, "Recent chats"), /*#__PURE__*/React.createElement("div", {
    style: sb.recent
  }, recents.map((r, i) => /*#__PURE__*/React.createElement("a", {
    key: i,
    onClick: () => onNavigate('chat', r),
    style: sb.recentA,
    onMouseEnter: e => e.currentTarget.style.background = 'var(--accent-tint)',
    onMouseLeave: e => e.currentTarget.style.background = 'none'
  }, /*#__PURE__*/React.createElement("div", {
    style: sb.recentT
  }, r.name), /*#__PURE__*/React.createElement("div", {
    style: sb.recentP
  }, r.preview)))), /*#__PURE__*/React.createElement("div", {
    style: sb.foot
  }, /*#__PURE__*/React.createElement("div", {
    style: sb.userRow
  }, /*#__PURE__*/React.createElement("span", {
    style: sb.userAva
  }, "K"), /*#__PURE__*/React.createElement("span", {
    style: sb.userName
  }, "kael_wren")), /*#__PURE__*/React.createElement("div", {
    style: sb.iconRow
  }, /*#__PURE__*/React.createElement(IconButton, {
    title: "Notifications"
  }, /*#__PURE__*/React.createElement(I.Bell, null)), /*#__PURE__*/React.createElement(IconButton, {
    title: "Settings"
  }, /*#__PURE__*/React.createElement(I.Gear, null)), /*#__PURE__*/React.createElement(IconButton, {
    title: "Toggle theme",
    onClick: onToggleTheme
  }, theme === 'light' ? /*#__PURE__*/React.createElement(I.Sun, null) : /*#__PURE__*/React.createElement(I.Sun, null)), /*#__PURE__*/React.createElement(IconButton, {
    title: "Log out"
  }, /*#__PURE__*/React.createElement(I.Logout, null))), /*#__PURE__*/React.createElement("div", {
    style: sb.conn
  }, /*#__PURE__*/React.createElement("span", {
    style: sb.connDot
  }), "chat \xB7 embed connected")));
}
const sb = {
  rail: {
    width: 250,
    flex: 'none',
    borderRight: '1px solid var(--line)',
    background: 'var(--surface-2)',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 16px',
    height: '100%',
    overflow: 'hidden'
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '2px 4px 26px'
  },
  glyph: {
    fontFamily: 'var(--display)',
    fontWeight: 600,
    fontSize: 20,
    background: 'linear-gradient(135deg,var(--accent),var(--violet-deep))',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    flex: 'none'
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.15
  },
  brandName: {
    fontFamily: 'var(--display)',
    fontWeight: 600,
    letterSpacing: '.03em',
    fontSize: 15
  },
  tagline: {
    fontSize: 10,
    fontStyle: 'italic',
    color: 'var(--muted)',
    marginTop: 2
  },
  nav: {
    display: 'flex',
    flexDirection: 'column'
  },
  navA: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '11px 12px',
    borderRadius: 9,
    color: 'var(--sec)',
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    transition: '.15s'
  },
  navAOn: {
    background: 'var(--accent-soft)',
    color: 'var(--accent-deep)'
  },
  navNew: {
    marginTop: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '11px 12px',
    borderRadius: 9,
    background: 'linear-gradient(135deg,var(--violet),var(--violet-deep))',
    color: 'var(--gold-ink)',
    fontWeight: 600,
    cursor: 'pointer'
  },
  railLabel: {
    fontFamily: 'var(--mono)',
    fontSize: 10,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    margin: '26px 10px 10px'
  },
  recent: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden'
  },
  recentA: {
    display: 'block',
    padding: '7px 10px',
    borderRadius: 7,
    cursor: 'pointer',
    transition: '.15s'
  },
  recentT: {
    fontSize: 13.5,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  recentP: {
    fontSize: 12,
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  foot: {
    marginTop: 'auto',
    paddingTop: 16,
    flex: 'none'
  },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: '1px solid var(--line)'
  },
  userAva: {
    width: 28,
    height: 28,
    borderRadius: 7,
    display: 'grid',
    placeItems: 'center',
    fontWeight: 700,
    fontSize: 12,
    color: 'var(--accent)',
    background: 'var(--accent-tint)',
    flex: 'none'
  },
  userName: {
    fontSize: 13.5,
    fontWeight: 500,
    fontFamily: 'var(--mono)',
    color: 'var(--sec)'
  },
  iconRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6
  },
  conn: {
    fontFamily: 'var(--mono)',
    fontSize: 10.5,
    color: 'var(--muted)',
    marginTop: 8,
    textAlign: 'center'
  },
  connDot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'var(--accent)',
    marginRight: 5,
    verticalAlign: 1
  }
};
window.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/app.jsx
try { (() => {
/* StoryHaven AI — kit app shell + router. */
const {
  LoginScreen,
  Sidebar,
  LibraryScreen,
  DossierScreen,
  ChatScreen
} = window;
function App() {
  const [authed, setAuthed] = React.useState(false);
  const [route, setRoute] = React.useState('library');
  const [active, setActive] = React.useState(null); // active character
  const [theme, setTheme] = React.useState('dark');
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const navigate = (r, payload) => {
    if (r === 'chat' && payload) {
      const c = window.SHData.characters.find(x => x.id === payload.id) || payload;
      setActive(c);
    }
    setRoute(r);
  };
  if (!authed) {
    return /*#__PURE__*/React.createElement(LoginScreen, {
      onLogin: () => {
        setAuthed(true);
        setRoute('library');
      }
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    route: route,
    onNavigate: navigate,
    onNewCharacter: () => setRoute('library'),
    theme: theme,
    onToggleTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
    recents: window.SHData.recents
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0,
      overflowY: route === 'chat' ? 'hidden' : 'auto',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }
  }, route === 'library' && /*#__PURE__*/React.createElement(LibraryScreen, {
    onOpen: c => {
      setActive(c);
      setRoute('dossier');
    }
  }), route === 'community' && /*#__PURE__*/React.createElement(LibraryScreen, {
    onOpen: c => {
      setActive(c);
      setRoute('dossier');
    }
  }), route === 'dossier' && active && /*#__PURE__*/React.createElement(DossierScreen, {
    character: active,
    onBack: () => setRoute('library'),
    onStartChat: c => {
      setActive(c);
      setRoute('chat');
    }
  }), route === 'chat' && active && /*#__PURE__*/React.createElement(ChatScreen, {
    character: active,
    onBack: () => setRoute('dossier')
  }), (route === 'personas' || route === 'images' || route === 'forum') && /*#__PURE__*/React.createElement(Placeholder, {
    route: route
  })));
}
function Placeholder({
  route
}) {
  const label = {
    personas: 'Personas',
    images: 'Creations',
    forum: 'Forum'
  }[route];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '30px 26px',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 11,
      letterSpacing: '.2em',
      textTransform: 'uppercase',
      color: 'var(--accent)'
    }
  }, label), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--display)',
      fontWeight: 600,
      fontSize: 30,
      margin: '4px 0 2px',
      color: 'var(--ink)'
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--sec)',
      fontSize: 15
    }
  }, "This surface isn't recreated in the kit. See Library, Dossier, and Chat for the interactive flow."));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/data.jsx
try { (() => {
/* StoryHaven AI — sample data for the kit (fictional characters, no real IP). */
window.SHData = {
  characters: [{
    id: 'aria',
    name: 'Aria Vance',
    mono: 'A',
    mode: 'character',
    tagline: 'A rogue archivist who knows far more than she lets on.',
    author: 'lorekeeper',
    chats: '1.2k',
    tags: ['Fantasy', 'Mystery'],
    greeting: "The archive door groans shut behind you. *She doesn't look up from the ledger.* \u201CYou're late. The moon's already over the west spire.\u201D",
    lore: 24,
    images: 12
  }, {
    id: 'gm-thornreach',
    name: 'The Warden of Thornreach',
    mono: '\u265C',
    mode: 'rpg',
    tagline: 'A grimdark survival campaign in a keep the forest is reclaiming.',
    author: 'dungeon_smith',
    chats: '860',
    tags: ['RPG', 'Grimdark'],
    greeting: "**Thornreach Keep \u2014 dusk.** The portcullis is rusted half-open. Somewhere beyond the treeline, something large shifts its weight. *What do you do?*",
    lore: 41,
    images: 6
  }, {
    id: 'juniper',
    name: 'Juniper',
    mono: 'J',
    mode: 'character',
    tagline: 'Your impossibly cheerful next-door barista with a secret.',
    author: 'sootandsugar',
    chats: '3.4k',
    tags: ['Slice of life', 'Cozy'],
    greeting: "*Juniper slides a mug across the counter, foam art shaped like a tiny fox.* \u201COne \u2018the usual.\u2019 On the house \u2014 you looked like you needed it today.\u201D",
    lore: 9,
    images: 20
  }, {
    id: 'vega',
    name: 'Captain Vega',
    mono: 'V',
    mode: 'character',
    tagline: 'Salvage captain, sharp tongue, sharper debts.',
    author: 'orbitaldrift',
    chats: '540',
    tags: ['Sci-fi', 'Adventure'],
    greeting: "*The airlock hisses.* \u201CDon't touch anything that blinks. Especially the red ones \u2014 those bite.\u201D",
    lore: 33,
    images: 8
  }, {
    id: 'mothwright',
    name: 'Professor Mothwright',
    mono: 'M',
    mode: 'rpg',
    tagline: 'A gaslamp mystery of letters, ciphers, and a missing heir.',
    author: 'inkwell',
    chats: '410',
    tags: ['RPG', 'Mystery'],
    greeting: "**Mothwright & Sons, Antiquarians.** Rain streaks the window. A sealed letter waits on the desk, addressed to you in a hand you almost recognize.",
    lore: 52,
    images: 4
  }, {
    id: 'sable',
    name: 'Sable',
    mono: 'S',
    mode: 'character',
    tagline: 'A guarded court sorcerer testing whether you can be trusted.',
    author: 'lorekeeper',
    chats: '2.1k',
    tags: ['Fantasy', 'Slow-burn'],
    greeting: "*Sable regards you over steepled fingers.* \u201CSpeak plainly. I have neither the patience nor the wine for riddles tonight.\u201D",
    lore: 28,
    images: 15
  }],
  recents: [{
    id: 'aria',
    name: 'Aria Vance',
    preview: 'You: Couldn\u2019t be helped \u2014 the road\u2026'
  }, {
    id: 'juniper',
    name: 'Juniper',
    preview: 'Juniper: See you tomorrow, then!'
  }, {
    id: 'gm-thornreach',
    name: 'The Warden of Thornreach',
    preview: 'GM: The portcullis groans\u2026'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/data.jsx", error: String((e && e.message) || e) }); }

// ui_kits/storyhaven-app/icons.jsx
try { (() => {
/* StoryHaven AI — icon set (Feather/Lucide-style 16px stroke SVGs).
   Lifted from static/index.html's inline nav SVGs so the kit matches the
   product exactly. Exposed on window.SHIcons for the other kit scripts. */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};
const Ico = (paths, vb = '0 0 24 24') => ({
  size = 16,
  style
} = {}) => React.createElement('svg', {
  width: size,
  height: size,
  viewBox: vb,
  ...stroke,
  style
}, paths);
const P = (d, k) => React.createElement('path', {
  d,
  key: k
});
const SHIcons = {
  Library: Ico([React.createElement('line', {
    x1: 8,
    y1: 6,
    x2: 21,
    y2: 6,
    key: 'a'
  }), React.createElement('line', {
    x1: 8,
    y1: 12,
    x2: 21,
    y2: 12,
    key: 'b'
  }), React.createElement('line', {
    x1: 8,
    y1: 18,
    x2: 21,
    y2: 18,
    key: 'c'
  }), React.createElement('line', {
    x1: 3,
    y1: 6,
    x2: 3.01,
    y2: 6,
    key: 'd'
  }), React.createElement('line', {
    x1: 3,
    y1: 12,
    x2: 3.01,
    y2: 12,
    key: 'e'
  }), React.createElement('line', {
    x1: 3,
    y1: 18,
    x2: 3.01,
    y2: 18,
    key: 'f'
  })]),
  Community: Ico([P('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'a'), React.createElement('circle', {
    cx: 9,
    cy: 7,
    r: 4,
    key: 'b'
  }), P('M23 21v-2a4 4 0 0 0-3-3.87', 'c'), P('M16 3.13a4 4 0 0 1 0 7.75', 'd')]),
  Personas: Ico([React.createElement('circle', {
    cx: 12,
    cy: 12,
    r: 10,
    key: 'a'
  }), P('M8 14s1.5 2 4 2 4-2 4-2', 'b'), React.createElement('line', {
    x1: 9,
    y1: 9,
    x2: 9.01,
    y2: 9,
    key: 'c'
  }), React.createElement('line', {
    x1: 15,
    y1: 9,
    x2: 15.01,
    y2: 9,
    key: 'd'
  })]),
  Creations: Ico([P('M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8', 'a'), React.createElement('circle', {
    cx: 12,
    cy: 12,
    r: 2.5,
    key: 'b'
  })]),
  Forum: Ico([P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'a')]),
  Plus: Ico([React.createElement('line', {
    x1: 12,
    y1: 5,
    x2: 12,
    y2: 19,
    key: 'a'
  }), React.createElement('line', {
    x1: 5,
    y1: 12,
    x2: 19,
    y2: 12,
    key: 'b'
  })]),
  Bell: Ico([P('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'a'), P('M13.73 21a2 2 0 0 1-3.46 0', 'b')]),
  Gear: Ico([React.createElement('circle', {
    cx: 12,
    cy: 12,
    r: 3,
    key: 'a'
  }), P('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z', 'b')]),
  Logout: Ico([P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'a'), React.createElement('polyline', {
    points: '16 17 21 12 16 7',
    key: 'b'
  }), React.createElement('line', {
    x1: 21,
    y1: 12,
    x2: 9,
    y2: 12,
    key: 'c'
  })]),
  Search: Ico([React.createElement('circle', {
    cx: 11,
    cy: 11,
    r: 8,
    key: 'a'
  }), React.createElement('line', {
    x1: 21,
    y1: 21,
    x2: 16.65,
    y2: 16.65,
    key: 'b'
  })]),
  ChevLeft: Ico([React.createElement('polyline', {
    points: '15 18 9 12 15 6',
    key: 'a'
  })]),
  Back: Ico([React.createElement('line', {
    x1: 19,
    y1: 12,
    x2: 5,
    y2: 12,
    key: 'a'
  }), React.createElement('polyline', {
    points: '12 19 5 12 12 5',
    key: 'b'
  })]),
  Memory: Ico([React.createElement('circle', {
    cx: 12,
    cy: 12,
    r: 9,
    key: 'a'
  }), React.createElement('polyline', {
    points: '12 7 12 12 16 14',
    key: 'b'
  })]),
  Brain: Ico([P('M9.5 3A2.5 2.5 0 0 1 12 5.5v13A2.5 2.5 0 0 1 7 18.5a2.5 2.5 0 0 1-2-4 2.5 2.5 0 0 1 0-4 2.5 2.5 0 0 1 2-4A2.5 2.5 0 0 1 9.5 3z', 'a'), P('M14.5 3A2.5 2.5 0 0 0 12 5.5v13a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 0 0-4 2.5 2.5 0 0 0-2-4A2.5 2.5 0 0 0 14.5 3z', 'b')]),
  Dice: Ico([React.createElement('rect', {
    x: 3,
    y: 3,
    width: 18,
    height: 18,
    rx: 3,
    key: 'a'
  }), React.createElement('circle', {
    cx: 8.5,
    cy: 8.5,
    r: 1.2,
    fill: 'currentColor',
    stroke: 'none',
    key: 'b'
  }), React.createElement('circle', {
    cx: 15.5,
    cy: 15.5,
    r: 1.2,
    fill: 'currentColor',
    stroke: 'none',
    key: 'c'
  }), React.createElement('circle', {
    cx: 8.5,
    cy: 15.5,
    r: 1.2,
    fill: 'currentColor',
    stroke: 'none',
    key: 'd'
  }), React.createElement('circle', {
    cx: 15.5,
    cy: 8.5,
    r: 1.2,
    fill: 'currentColor',
    stroke: 'none',
    key: 'e'
  })]),
  Image: Ico([React.createElement('rect', {
    x: 3,
    y: 3,
    width: 18,
    height: 18,
    rx: 2,
    key: 'a'
  }), React.createElement('circle', {
    cx: 8.5,
    cy: 8.5,
    r: 1.5,
    key: 'b'
  }), React.createElement('polyline', {
    points: '21 15 16 10 5 21',
    key: 'c'
  })]),
  Sun: Ico([React.createElement('circle', {
    cx: 12,
    cy: 12,
    r: 5,
    key: 'a'
  }), P('M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4', 'b')])
};
window.SHIcons = SHIcons;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/storyhaven-app/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.ChatBubble = __ds_scope.ChatBubble;

__ds_ns.Composer = __ds_scope.Composer;

__ds_ns.CharacterCard = __ds_scope.CharacterCard;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.ModeBadge = __ds_scope.ModeBadge;

__ds_ns.StatPill = __ds_scope.StatPill;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.SearchField = __ds_scope.SearchField;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.TextField = __ds_scope.TextField;

})();
