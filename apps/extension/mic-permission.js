// One-time microphone grant for the extension origin: side panels cannot show
// the permission prompt, so the panel opens this top-level page, the grant
// lands on chrome-extension://<id>, and every later panel dictation session
// uses it. Extension CSP forbids inline scripts, hence this file.
const status = document.getElementById('status')
navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  for (const track of stream.getTracks()) track.stop()
  status.textContent = '已获得麦克风权限。回到侧边栏重新点击麦克风按钮即可开始语音输入，本页面可以关闭了。'
}, () => {
  status.textContent = '授权被拒绝。请点击地址栏左侧的站点设置图标，将麦克风改为"允许"，然后刷新本页面重试。'
})
