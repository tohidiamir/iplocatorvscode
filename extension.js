const vscode = require('vscode');

let statusBarItem;
let checkStatusItem;   // آیتم دوم: نشان‌دهنده آخرین چک
let intervalHandle;
let outputChannel;

const CHECK_INTERVAL_MS = 30 * 1000; // هر ۳۰ ثانیه
const BLOCKED_COUNTRY_CODES = ['IR'];
const MAX_HISTORY = 10;

// وضعیت داخلی
let lastKnownIP = null;        // آخرین IP که دیدیم
let foreignIPHistory = [];     // تاریخچه ۱۰ IP خارجی

// ---- ذخیره‌سازی تاریخچه ----

function loadHistory(context) {
  foreignIPHistory = context.globalState.get('ipHistory', []);
  lastKnownIP = context.globalState.get('lastIP', null);
}

function saveHistory(context) {
  context.globalState.update('ipHistory', foreignIPHistory);
  context.globalState.update('lastIP', lastKnownIP);
}

// ---- دریافت IP ----

async function fetchIPInfo() {
  const providers = [
    'https://ipapi.co/json/',
    'https://ipwho.is/'
  ];

  for (const url of providers) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();

      return {
        ip:          data.ip          || data.query   || 'نامعلوم',
        countryCode: data.country_code || data.country || 'XX',
        countryName: data.country_name || data.country || 'نامعلوم',
        city:        data.city         || ''
      };
    } catch (e) { continue; }
  }
  return null;
}

// ---- منطق اصلی ----

async function runCheck(context) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('fa-IR');

  // آپدیت آیتم دوم — نشان بده داریم چک می‌کنیم
  checkStatusItem.text = `$(sync~spin) چک IP...`;
  checkStatusItem.show();

  const info = await fetchIPInfo();

  // آپدیت آیتم دوم با زمان
  checkStatusItem.text = `$(clock) آخرین چک: ${timeStr}`;
  checkStatusItem.tooltip = `هر ${CHECK_INTERVAL_MS / 60000} دقیقه یک‌بار بررسی می‌شود\nکلیک = مشاهده تاریخچه`;
  checkStatusItem.show();

  if (!info) {
    statusBarItem.text = '$(warning) IP: نامشخص';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.tooltip = 'عدم دسترسی به سرویس تشخیص IP';
    statusBarItem.show();
    outputChannel.appendLine(`[${timeStr}] ❌ خطا در دریافت IP`);
    return;
  }

  const isBlocked = BLOCKED_COUNTRY_CODES.includes(info.countryCode);
  const prevIP    = lastKnownIP;

  // --- تشخیص تغییر IP ---
  if (prevIP && prevIP !== info.ip) {
    const msg = `🔄 IP تغییر کرد!\nقبلی: ${prevIP}\nجدید: ${info.ip} (${info.countryName})`;
    vscode.window.showWarningMessage(msg, 'مشاهده تاریخچه').then(sel => {
      if (sel === 'مشاهده تاریخچه') showHistory();
    });
    outputChannel.appendLine(`[${timeStr}] 🔄 تغییر IP: ${prevIP} → ${info.ip} (${info.countryName})`);
  }

  // --- ذخیره IP جدید ---
  lastKnownIP = info.ip;

  // اگه خارجی بود به تاریخچه اضافه کن
  if (!isBlocked) {
    const exists = foreignIPHistory.find(h => h.ip === info.ip);
    if (!exists) {
      foreignIPHistory.unshift({
        ip:          info.ip,
        countryCode: info.countryCode,
        countryName: info.countryName,
        city:        info.city,
        seenAt:      now.toISOString()
      });
      if (foreignIPHistory.length > MAX_HISTORY) {
        foreignIPHistory = foreignIPHistory.slice(0, MAX_HISTORY);
      }
    }
  }

  saveHistory(context);

  // --- آپدیت Status Bar اصلی ---
  if (isBlocked) {
    statusBarItem.text = `$(circle-slash) IP: ${info.ip} — ایران`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.tooltip = `کشور: ${info.countryName}\nاتصال از این منطقه محدود است\nکلیک = بررسی مجدد IP`;
    vscode.window.showErrorMessage(
      `⛔ IP شما ایرانی است: ${info.ip}`,
      'مشاهده تاریخچه'
    ).then(sel => { if (sel === 'مشاهده تاریخچه') showHistory(); });
  } else {
    statusBarItem.text = `$(globe) IP: ${info.ip} (${info.countryName})`;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = `کشور: ${info.countryName}\nشهر: ${info.city}\nکلیک = بررسی مجدد IP`;
  }

  statusBarItem.show();

  // لاگ
  const flag = isBlocked ? '🚫' : '✅';
  outputChannel.appendLine(`[${timeStr}] ${flag} ${info.ip} | ${info.countryName} ${info.city ? '- ' + info.city : ''}`);
}

// ---- نمایش تاریخچه در Output Channel ----

function showHistory() {
  outputChannel.clear();
  outputChannel.appendLine('═══════════════════════════════════');
  outputChannel.appendLine('  📋  تاریخچه آخرین IPهای خارجی  ');
  outputChannel.appendLine('═══════════════════════════════════');

  if (foreignIPHistory.length === 0) {
    outputChannel.appendLine('  (هنوز IP خارجی ثبت نشده)');
  } else {
    foreignIPHistory.forEach((h, i) => {
      const date = new Date(h.seenAt).toLocaleString('fa-IR');
      outputChannel.appendLine(`  ${i + 1}. ${h.ip.padEnd(18)} ${h.countryName} ${h.city ? '- ' + h.city : ''}`);
      outputChannel.appendLine(`     📅 ${date}`);
    });
  }

  outputChannel.appendLine('═══════════════════════════════════');
  outputChannel.show(true);
}

// ---- فعال‌سازی ----

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('IP Guard');
  loadHistory(context);

  // آیتم اصلی — IP و کشور
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  statusBarItem.command = 'ipGuard.refresh';
  context.subscriptions.push(statusBarItem);
  statusBarItem.text = '$(sync~spin) IP Guard...';
  statusBarItem.show();

  // آیتم دوم — زمان آخرین چک
  checkStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  checkStatusItem.command = 'ipGuard.showHistory';
  context.subscriptions.push(checkStatusItem);

  // دستورات
  context.subscriptions.push(
    vscode.commands.registerCommand('ipGuard.refresh',     () => runCheck(context)),
    vscode.commands.registerCommand('ipGuard.showHistory', showHistory)
  );

  // اجرای اول
  runCheck(context);

  // چک دوره‌ای
  intervalHandle = setInterval(() => runCheck(context), CHECK_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(intervalHandle) });
}

function deactivate() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = { activate, deactivate };
