/** `weixin` namespace dictionaries (the WeChat settings section's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  nav: '消息渠道',
  lead: '扫码后，微信里发来的消息由本机智能体回答，回复直接发回聊天。只需关联一次。',
  'state.linked': '已关联',
  'action.link': '生成二维码',
  'action.linking': '正在生成…',
  'action.unlink': '解除关联',
  'qr.alt': '微信登录二维码',
  'qr.hint': '用微信扫描二维码，并在手机上确认。',
  'qr.scanned': '已扫码，请在微信中确认。',
  'qr.fallback': '无法扫描？在浏览器中打开链接',
  'error.link': '无法获取二维码，请稍后重试。',
} satisfies Record<string, string>

/** The weixin namespace key union. */
export type WeixinKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  nav: 'Messaging',
  lead: 'Scan once to link an account: messages sent to it are answered by this workstation\'s agent, and replies go straight back to the chat.',
  'state.linked': 'Linked',
  'action.link': 'Show QR code',
  'action.linking': 'Requesting…',
  'action.unlink': 'Unlink',
  'qr.alt': 'WeChat login QR code',
  'qr.hint': 'Scan with WeChat, then confirm on your phone.',
  'qr.scanned': 'Scanned — confirm in WeChat to finish.',
  'qr.fallback': 'Cannot scan? Open the link in a browser',
  'error.link': 'Could not obtain a QR code; try again shortly.',
} satisfies Record<WeixinKey, string>
