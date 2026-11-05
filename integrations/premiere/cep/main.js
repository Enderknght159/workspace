/* Workspace Premiere Bridge — CEP panel.
 * يستمع لطابور المهام في مجلد المكتب، ويشغّل سكربت ExtendScript
 * الذي ينشئ المشروع ويستورد المصادر.
 */
(function () {
  var officeInput = document.getElementById('office');
  var logBox = document.getElementById('log');
  var stateLabel = document.getElementById('state');
  var dot = document.getElementById('dot');
  var timer = null;
  var processed = {};

  function log(message) {
    var line = new Date().toLocaleTimeString() + '  ' + message;
    logBox.textContent = line + '\n' + logBox.textContent;
    if (logBox.textContent.length > 4000) logBox.textContent = logBox.textContent.slice(0, 4000);
  }

  function getSystemPath(name) {
    try {
      return window.__adobe_cep__.getSystemPath(name);
    } catch (e) {
      return '';
    }
  }

  function evalScript(script, callback) {
    window.__adobe_cep__.evalScript(script, callback);
  }

  function queueDir() {
    var office = localStorage.getItem('workspace.office');
    return office ? office.replace(/[\\/]+$/, '') + '\\integrations\\premiere\\queue' : '';
  }

  function readJson(path) {
    var result = window.cep.fs.readFile(path);
    if (result.err !== 0) return null;
    try {
      return JSON.parse(result.data);
    } catch (e) {
      return null;
    }
  }

  function poll() {
    var dir = queueDir();
    if (!dir) return;
    var listing = window.cep.fs.readdir(dir);
    if (listing.err !== 0) return;
    var files = listing.data || [];
    for (var i = 0; i < files.length; i += 1) {
      var name = files[i];
      if (name.slice(-5) !== '.json') continue;
      var path = dir + '\\' + name;
      if (processed[path]) continue;
      var command = readJson(path);
      if (!command || !command.jsx_path) continue;
      if (!command.task_id) continue;
      processed[path] = true;
      log('تشغيل مهمة ' + command.task_id);
      evalScript('$.evalFile(' + JSON.stringify(command.jsx_path) + ')', function (result) {
        log('نتيجة: ' + String(result));
        if (String(result).indexOf('OK') === 0) {
          window.cep.fs.deleteFile(path);
        } else {
          // نبقيه للمحاولة التالية بعد إصلاح المشكلة.
          processed[path] = false;
        }
      });
    }
  }

  function start() {
    var office = officeInput.value.trim();
    if (!office) {
      log('أدخل مسار مجلد المكتب أولًا.');
      return;
    }
    localStorage.setItem('workspace.office', office);
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 2500);
    dot.style.background = '#74c8a4';
    stateLabel.textContent = 'يعمل — يراقب الطابور';
    log('بدأ المراقبة: ' + office);
    poll();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    dot.style.background = '#e38575';
    stateLabel.textContent = 'متوقف';
    log('أوقف المراقبة.');
  }

  var myDocuments = getSystemPath('myDocuments');
  var saved = localStorage.getItem('workspace.office');
  officeInput.value = saved || (myDocuments ? myDocuments + '\\WorkspaceOffice' : '');
  document.getElementById('save').addEventListener('click', start);
  document.getElementById('stop').addEventListener('click', stop);
  if (saved) start();
})();
