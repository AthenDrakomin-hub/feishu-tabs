/**
 * 公共模态输入弹窗
 * 统一重命名、API Key 设置等单行输入场景，消除重复的内联 HTML 弹窗
 * 通过 console-message 回传结果（沙箱页面无 preload 时的轻量通信）
 */
const { BrowserWindow } = require('electron');

/**
 * @param {object} opts
 * @param {string} opts.title 窗口标题
 * @param {string} opts.label 输入框标签
 * @param {string} [opts.initialValue] 初始值
 * @param {string} [opts.placeholder] 占位符
 * @param {number} [opts.width=380]
 * @param {number} [opts.height=210]
 * @param {BrowserWindow} [opts.parent] 父窗口
 * @param {boolean} [opts.password=false] 是否密码框
 * @param {string} [opts.hint] 底部提示文字（纯文本）
 * @returns {Promise<string|null>} 用户输入值，取消/关闭返回 null
 */
function showInputDialog(opts) {
  return new Promise((resolve) => {
    const {
      title,
      label,
      initialValue = '',
      placeholder = '',
      width = 380,
      height = 210,
      parent,
      password = false,
      hint = '',
    } = opts;

    const win = new BrowserWindow({
      width,
      height,
      parent,
      modal: true,
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      title,
      webPreferences: { contextIsolation: true, sandbox: true },
    });

    const safeInitial = String(initialValue).replace(/"/g, '&quot;');
    const safePlaceholder = String(placeholder).replace(/"/g, '&quot;');
    const hintBlock = hint ? `<div class="hint">${String(hint).replace(/</g, '&lt;')}</div>` : '';
    const inputType = password ? 'password' : 'text';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:system-ui;margin:20px;display:flex;flex-direction:column;gap:12px}
      label{font-size:13px;color:#333}
      input{padding:9px 10px;font-size:13px;border:1px solid #ccc;border-radius:6px;outline:none}
      input:focus{border-color:#3370ff}
      .hint{font-size:11px;color:#86909c;line-height:1.5}
      .btns{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}
      button{padding:7px 18px;border-radius:6px;border:1px solid #ccc;background:#f5f5f5;cursor:pointer;font-size:13px}
      button.primary{background:#3370ff;color:#fff;border-color:#3370ff}
    </style></head><body>
      <label>${label}</label>
      <input id="inp" type="${inputType}" value="${safeInitial}" placeholder="${safePlaceholder}" autofocus>
      ${hintBlock}
      <div class="btns">
        <button id="cancel">取消</button>
        <button id="ok" class="primary">确定</button>
      </div>
      <script>
        var inp = document.getElementById('inp'); inp.select();
        function submit(){ console.log('INPUT_DIALOG_RESULT:' + inp.value.trim()); }
        document.getElementById('ok').onclick = submit;
        document.getElementById('cancel').onclick = function(){ console.log('INPUT_DIALOG_CANCEL'); };
        inp.onkeydown = function(e){ if(e.key==='Enter') submit(); if(e.key==='Escape') console.log('INPUT_DIALOG_CANCEL'); };
      </script>
    </body></html>`;

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.close();
      resolve(val);
    };

    win.webContents.on('console-message', (_e, _level, message) => {
      if (message.startsWith('INPUT_DIALOG_RESULT:')) {
        finish(message.slice('INPUT_DIALOG_RESULT:'.length) || null);
      } else if (message === 'INPUT_DIALOG_CANCEL') {
        finish(null);
      }
    });
    win.on('closed', () => finish(null));
  });
}

module.exports = { showInputDialog };
