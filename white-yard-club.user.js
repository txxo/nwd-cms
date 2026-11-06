// ==UserScript==
// @name         White Yard Club · 每日預訂時間表
// @namespace    wy-daily-reservation-schedule
// @version      1.3.79
// @description  每日設施時間表，整合 Out of Service 灰色封鎖時段及 Remark，顯示付款狀態與建立時間。
// @match        https://apps.nwd.com.hk/CMS/Club/FacilityBooking.aspx*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      www.1823.gov.hk
// @connect      data.weather.gov.hk
// @run-at       document-end
// @updateURL    https://github.com/txxo/nwd-cms/raw/refs/heads/main/white-yard-club.user.js
// @downloadURL    https://github.com/txxo/nwd-cms/raw/refs/heads/main/white-yard-club.user.js
// ==/UserScript==

(function reservationMain(C) {
  'use strict';

  /* 1.3.75: colour mixed-status bookings individually; block repeated create SAVE clicks while saving.
     1.3.74: show only the create-time Change To while creating; retain the native status controls for existing bookings.
     1.3.73: transparent loading background; create-time Change To next to the native status control; default Pending label.
     1.3.72: show loading from the create SAVE click through native status confirmation and the final painted refresh; release on validation/save failure.
     1.3.71: no native "Saved" popup (short toast instead); create-time choice is Pending/Settled only; Settled-at-creation runs invisibly with a single refresh.
     1.3.70: new booking form - choose the final status (Settled / Overdue) at creation; carried out natively right after the booking is saved.
     1.3.69: new booking, Tower 25 - ground-floor Flat A-D keep showing G/F but select the native LG/F & G/F floor; Flat E/F use plain G/F. (Based on 1.3.67.)
     1.3.67: visual refresh only (drafting-sheet skin) - CSS tokens/overrides, iframe record-view CSS, weekend colour; no logic changes.
     1.3.57: bundle UI 1.2; collapse Resident Zone/Setting once on load;
     compact inactive records with facility column labels and cancellation reasons;
     reuse the status node inside the forecast heading on every forecast refresh. */

  if (document.getElementById('wyDailySheet')) return;

  const API = '/CMS/services/FacilityBookingServices.asmx/';

  let root, panel, table, oldTable;
  let busy = false;
  let bookingSave = null;
  let mode = true;
  let data = [];
  let noServiceData = [];
  let scheduleReady = false;
  let shownDate = '';
  let controller;
  let serial = 0;

  let dateInput, status, dateText, warning, weatherSlot;
  let refreshButton;
  let inactiveSection, loadingOverlay, loadingLabel;
  let modeButton;
  let oldPager = [];
  let pagerDisplays = new Map();
  let originalDisplay = '';
  const style = document.createElement('style');
  style.textContent = `

/* White Yard Club · UI 1.2
   Replace the complete style.textContent assignment with this file.
   Colors: edit the variables below. Timetable rows remain 45px;
   forecast cards remain 50px. TreeView expansion is controlled by CMS. */
:root {
  --wy-font:"Avenir Next","Segoe UI Variable Text","Segoe UI","PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;
  --wy-text:#1E2B2A; --wy-muted:#5C6B68;
  --wy-accent:#234B43; --wy-accent-hover:#183630;
  --wy-border:#CBD3D0; --wy-grid:#C9D1CD;
  --wy-soft:#F3F5F2; --wy-hover:#E7EEEA;
  --wy-paid:#E3EFE4; --wy-pending:#FAEBC0;
  --wy-ink:#1E2B2A; --wy-lawn:#3E7D4F; --wy-ochre:#C48A12; --wy-lake:#2D6A8F; --wy-red:#B4412F;
  --wy-radius:3px; --wy-shadow:0 10px 30px #1e2b2a29;
}

/* Nine-day forecast: font sizes, icon size and spacing can be adjusted here. */
.clsMasterHead:has(#wyNineDayForecast) {height:auto!important;overflow:visible!important;}
#wyNineDayForecast {clear:both;display:block;width:100%;min-width:0;padding:10px 0;color:var(--wy-text);font:13px var(--wy-font);line-height:1.4;text-align:left;box-sizing:border-box;}
#wyNineDayForecast * {box-sizing:border-box;}
#wyNineDayForecast .wyForecastHeading {display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px;font-weight:bold;}
#wyNineDayForecast .wyForecastMeta {font-size:11px;font-weight:normal;color:var(--wy-muted);}
#wyNineDayForecast .wyForecastDays {display:grid;grid-template-columns:repeat(9,minmax(148px,1fr));gap:6px;overflow-x:auto;padding-bottom:4px;}
#wyNineDayForecast .wyForecastDay {display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:148px;height:50px;padding:4px 6px;font-size:12px;line-height:16px;border:1px solid #D5DCD8;border-radius:3px;background:#FBFCFB;color:var(--wy-text);white-space:nowrap;}
#wyNineDayForecast .wyForecastRow {display:flex;align-items:center;justify-content:center;gap:6px;width:100%;white-space:nowrap;}
#wyNineDayForecast .wyForecastTop {height:22px;flex:0 0 22px;}
#wyNineDayForecast .wyForecastBottom {height:16px;flex:0 0 16px;}
#wyNineDayForecast .wyForecastDate {font-weight:bold;}
#wyNineDayForecast .wyForecastWeekend {color:#B4412F;}
#wyNineDayForecast img {display:block;width:22px;height:22px;flex:0 0 22px;object-fit:contain;background:var(--wy-accent);border-radius:4px;}
#wyNineDayForecast .wyForecastTemp {font-weight:bold;font-size:11px;}
#wyNineDayForecast .wyForecastHumidity {font-size:11px;color:var(--wy-muted);}
@media print {
#wyNineDayForecast {display:none!important;}
}
#wyDailySheet .wyWeatherSlot {display:flex;align-items:center;justify-content:flex-end;min-width:0;max-width:100%;}
#wyDailySheet .wyWeather {display:inline-flex;align-items:center;gap:12px;color:var(--wy-text);font:bold 20px var(--wy-font);white-space:nowrap;}
#wyDailySheet .wyWeatherIcons {display:inline-flex;align-items:center;gap:2px;padding:1px 8px;border-radius:18px;background:var(--wy-accent);}
#wyDailySheet .wyWeatherIcons img {display:block;width:26px;height:26px;object-fit:contain;}
#wyDailySheet .wyWeatherWarnings {display:inline-flex;align-items:center;flex-wrap:wrap;gap:5px;max-width:100%;}
#wyDailySheet .wyWeatherWarning {display:inline-flex;align-items:center;justify-content:center;min-width:30px;min-height:30px;}
#wyDailySheet .wyWeatherWarning img {display:block;width:32px;height:32px;object-fit:contain;}
#wyDailySheet .wyWeatherWarningFallback {font-size:12px;color:#a13b16;white-space:normal;}
#wyDailySheet .wyWeather {flex-wrap:wrap;}
#wyDailySheet .wyWeatherLive {font-size:10px;font-weight:normal;color:var(--wy-muted);}
#wyDailySheet .wyBlockingOverlay {position:fixed;inset:0;z-index:2147483641;background:#0007;display:flex;align-items:center;justify-content:center;padding:12px;}
#wyDailySheet .wyBlockingOverlay[hidden] {display:none!important}
#wyDailySheet .wyBlockingCard {display:flex;flex-direction:column;background:white;width:min(880px,96vw);height:88vh;max-height:900px;border-radius:10px;overflow:hidden;box-shadow:0 8px 30px #0005;}
#wyDailySheet .wyBlockingBar {display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;background:var(--wy-accent);color:white;flex-shrink:0;}
#wyDailySheet .wyBlockingCard iframe {display:block;border:0;width:100%;flex:1;min-height:0;background:white;}
/* Remove the host's upper inset only while the original list is hidden. */
.wyScheduleHost:has(> .wyOriginalHidden) {padding-top:0!important;}
#wyDailySheet .wyOriginalActions {display:flex;align-items:center;flex-wrap:wrap;gap:9px;}
#wyDailySheet .wyOriginalAction {background:rgb(214,188,178);color:#fff;border:0;border-radius:0;padding:6px 22px;font:normal 14px var(--wy-font);line-height:18px;box-shadow:none;cursor:pointer;}
#wyDailySheet .wyOriginalAction:hover {background:rgb(180,139,126);}
#wyDailySheet .wyOriginalAction[hidden] {display:none!important;}
.search-page-master.wyOriginalHidden {display:none!important;}
#wyDailySheet .wyCalendarInput {width:128px;border:1px solid var(--wy-border);border-radius:4px;padding:6px;font:inherit;text-align:center;cursor:pointer;}
#ui-datepicker-div {z-index:2147483640!important;}
#wyDailySheet .wyGridLocator {position:fixed;z-index:2147483500;pointer-events:none;overflow:hidden;}
#wyDailySheet .wyLocatorRow {position:absolute;border:2px solid #2D6A8F;box-sizing:border-box;}
#wyDailySheet .wyLocatorRow {border-right:0;}
#wyDailySheet td.wyBookable.wyHoveredCell {background:#ffeb80!important;}
#wyDailySheet .wyLocatorCell {position:absolute;border:2px solid #2D6A8F;box-sizing:border-box;}
@media print {
#wyDailySheet td.wyHoveredCell {background:revert!important;}
}
@media print {
#wyDailySheet .wyGridLocator {display:none!important;}
}
#wyDailySheet .wyFixedGrey {background: #d9d9d9 !important;}
#wyDailySheet .wyBlockedCell {background:#d9d9d9 !important;cursor:default;position:relative;}
/* Keep rowspan content out of intrinsic row sizing. The cell retains its
   table layout; long or overlapping blocks scroll within the merged area. */
#wyDailySheet .wyBlockedContent {position:absolute;inset:3px 5px;overflow:auto;min-width:0;display:flex;flex-direction:column;overscroll-behavior:contain;}
/* Auto margins center short content; resolve to zero on overflow so the
   start of long content remains reachable by scrolling. */
#wyDailySheet .wyBlockedInner {flex:0 0 auto;width:100%;margin-block:auto;}
#wyDailySheet .wyBlockedContent:focus-visible {outline:2px solid #2D6A8F;outline-offset:-2px;}
#wyDailySheet .wyBlocked {display:block;padding:3px 0;color:#37474f;font-weight:bold;}
#wyDailySheet .wyBlockRemark {display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-height:1;overflow:hidden;white-space:pre-line;overflow-wrap:anywhere;font-size:12px
;}
#wyDailySheet .wyBlocked small {display:block;font-size:12px;font-weight:normal;margin-top:0px;}
#wyDailySheet .wyBlocked + .wyBlocked {border-top:0px dashed #aaa;}
#wyDailySheet .wyBooking small {white-space: pre-line;}
#wyDailySheet h2,#wyDailySheet .wyFine,#wyDailySheet .wyRemarks,#wyDailySheet .wySign {display:none!important;}
#wyDailySheet {clear:both;margin:0;background:#fff;color:var(--wy-text);font:14px var(--wy-font);border:0;border-radius:0;box-shadow:none;padding:4px 0 0;box-sizing:border-box;}
#wyDailySheet * {box-sizing:border-box;}
#wyDailySheet .wyBar {display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;}
#wyDailySheet button {border:1px solid var(--wy-border);border-radius:4px;background:#fff;color:var(--wy-text);padding:7px 11px;cursor:pointer;font:inherit;}
#wyDailySheet button:hover {background:var(--wy-hover);}
#wyDailySheet button:disabled {opacity:.45;cursor:default;}
#wyDailySheet .wyPrimary {background:var(--wy-accent);color:white;}
#wyDailySheet input[type=date] {border:1px solid var(--wy-border);border-radius:4px;padding:6px;font:inherit;}
#wyDailySheet label {display:inline-flex;gap:5px;align-items:center;}
#wyDailySheet .wyDate {text-align:center;margin:1px 0;}
#wyDailySheet .wyStatus {background:#f2f5f6;padding:9px;margin-bottom:12px;line-height:1.6;}
#wyDailySheet .wyError {background:#fff0ed;color:#913b27;}
#wyDailySheet .wyScroll {overflow-x:auto;}
#wyDailySheet table {width:100%;border-collapse:collapse;table-layout:fixed;min-width:1450px;}
#wyDailySheet th,#wyDailySheet td {border:1px solid var(--wy-grid);padding:1px 1px;text-align:center;vertical-align:middle;word-break:break-word;}
#wyDailySheet th {background:var(--wy-accent);color:#fff;font-weight:bold;height:48px;}
#wyDailySheet th:first-child {width:112px;}
#wyDailySheet .wyHeaderZh {display:block;margin-top:1px;line-height:1;}
#wyDailySheet tbody tr {height:45px;}
#wyDailySheet td {height:auto;padding:1px 1px;}
#wyDailySheet tbody tr.wyEmptyRow {height:45px;}
#wyDailySheet tbody tr.wyEmptyRow td {padding:1px 1px;line-height:1;}
#wyDailySheet .wyPayment {border-radius:1px;padding:1px 1px;}
#wyDailySheet .wyPending .wyPayment {background:var(--wy-pending);color:#846114;}
#wyDailySheet .wySettled .wyPayment {background:var(--wy-paid);color:#24572d;}
#wyDailySheet .wySport {font-weight:bold;}
#wyDailySheet .wyFPSPayment {white-space:nowrap!important;}
#wyDailySheet td.wyBookable {cursor:pointer;}
#wyDailySheet td.wyBookable:hover {background:var(--wy-hover);}
#wyDailySheet .wyInactive {margin-top:18px;}
#wyDailySheet .wyInactive table {min-width:850px;}
#wyDailySheet .wyInactive tr {height:auto;}
#wyDailySheet .wyInactive td {padding:8px 5px;}
#wyDailySheet .wyInactiveTitle {font-weight:bold;margin-bottom:10px;}
#wyDailySheet .wyHoverDetails {position:fixed;z-index:2147483601;width:350px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;pointer-events:none;background:white;color:var(--wy-text);border:1px solid var(--wy-border);border-radius:3px;padding:14px;box-shadow:0 5px 20px #0003;text-align:left;font-size:13px;}
#wyDailySheet .wyHoverDetails p {margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere;}
#wyDailySheet .wyTime {font-weight:bold;font-size:13px;background:#F3F5F2;white-space:nowrap;}
#wyDailySheet .wySettledCell {background:var(--wy-paid);}
#wyDailySheet .wyPendingCell {background:var(--wy-pending);}
#wyDailySheet .wyBooking {width:100%;border:0;background:none;font-weight:bold;}
#wyDailySheet .wyBooking:hover {background:#00000008;}
#wyDailySheet .wyBooking small {display:block;font-weight:normal;font-size:11px;margin-top:0px;line-height:1.25;}
#wyDailySheet .wyBooking .wyPayment {font-weight:bold;}
#wyDailySheet .wyCancelled {text-decoration:line-through;color:#888;}
#wyDailySheet .wyPending {color:#846114;}
#wyDailySheet .wyOverdue {color:#777;}
#wyDailySheet .wyWarning {margin:10px 0;padding:9px;background:#fff4d7;color:#735418;line-height:1.7;}
#wyDailySheet .wyModal {position:fixed;inset:0;background:#0007;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:20px;}
#wyDailySheet .wyCard {background:white;width:min(630px,95vw);max-height:85vh;overflow:auto;padding:24px;border-radius:8px;text-align:left;}
#wyDailySheet .wyCard h3 {margin:0 0 16px;}
#wyDailySheet .wyCard p {line-height:1.7;white-space:pre-wrap;word-break:break-word;}
#wyDailySheet :focus-visible {outline:3px solid #2D6A8F;outline-offset:2px;}
/* A reservation hour is 45px: 38px viewport + 6px padding + 1px border.
   Multiple records scroll inside the cell rather than increasing row height. */
#wyDailySheet .wyReservationContent {height:40px;overflow:auto;overscroll-behavior:contain;}
#wyDailySheet .wyBooking {display:grid;grid-template-columns:minmax(0,1fr) max-content;grid-template-areas:"unit time" "sport payment";gap:1px 2px;align-items:center;padding:0px 0;line-height:2;}
#wyDailySheet .wyBookingUnit {grid-area:unit;font-size:20px;}
#wyDailySheet .wyBookingTime {grid-area:time;}
#wyDailySheet .wyBooking .wySport {grid-area:sport;font-size:14px;}
#wyDailySheet .wyBooking .wyPayment {grid-area:payment;padding:0;font-size:12px;white-space:nowrap!important;overflow:visible;text-overflow:clip;}
#wyDailySheet .wyBooking > * {min-width:0;overflow:visible;text-overflow:clip;white-space:normal!important;overflow-wrap:anywhere;margin:0;font-size:14px;}
#wyDailySheet .wyBooking .wyBookingUnit {font-size:14px;}
#wyDailySheet .wyBooking .wyBookingTime {white-space:nowrap!important;font-size:12px;}

div.clsLogoH,
div.clsLogoWord,
div.clsInfo {
  display: none !important;
}

/* 1. Clean page frame and compact forecast. */
body {background:#fff!important;color:var(--wy-text);font-family:var(--wy-font)!important}
.clsMasterHead {background:#EFF2EE!important;border-bottom:1px solid var(--wy-border)!important;box-shadow:none!important}
.clsMasterBody {background:#fff!important}
#wyNineDayForecast {padding:8px 12px 6px;font-family:var(--wy-font)}
#wyNineDayForecast .wyForecastHeading {gap:10px;margin-bottom:5px;font-size:12px;color:var(--wy-accent)}
#wyNineDayForecast .wyForecastMeta {color:var(--wy-muted);font-size:11px}
#wyNineDayForecast .wyForecastDays {gap:6px;padding-bottom:3px}
#wyNineDayForecast .wyForecastDay {height:50px;background:#fff;border-color:var(--wy-border);border-radius:var(--wy-radius);box-shadow:none}
#wyNineDayForecast .wyForecastWeekend {color:#B4412F}

/* 2. Native ASP.NET TreeView. Preserve tables, indent spacers and toggle icons. */
.clsMenuBar {background:var(--wy-soft)!important;border-right:1px solid var(--wy-border)!important;font-family:var(--wy-font)!important;width: 200px !important;min-width: 0 !important;box-sizing: border-box;}
.clsMenuBar #menuLeft {background:transparent!important;padding:8px 6px!important}
.clsMenuBar #menuLeft table {background:transparent;border:0;border-spacing:0!important;margin-block:0!important}
.clsMenuBar #menuLeft td {border:0;padding-block:0!important;height:auto!important;vertical-align:middle}
.clsMenuBar #menuLeft a.menuLeft_0 {display:inline-block!important;padding:3px 8px!important;border-radius:5px;color:#44524F!important;font:14px var(--wy-font)!important;line-height:20px!important;text-decoration:none!important;vertical-align:middle;transition:background-color .12s}
.clsMenuBar #menuLeft a.menuLeft_0:hover {background:var(--wy-hover)!important;color:var(--wy-accent)!important}
.clsMenuBar #menuLeft a.menuLeft_1,.clsMenuBar #menuLeft a.menuLeft_3 {color:var(--wy-accent)!important;font-weight:700!important}
.clsMenuBar #menuLeft td.MenuSelected {background:transparent!important}
.clsMenuBar #menuLeft a.MenuSelected {background:var(--wy-accent)!important;color:#fff!important;font-weight:700!important;box-shadow:none!important}
.clsMenuBar #menuLeft a.MenuSelected:hover {background:var(--wy-accent-hover)!important;color:#fff!important}
.clsMenuBar #menuLeft a:focus-visible {outline:2px solid #2D6A8F;outline-offset:2px}

/* 3. Toolbar: shared button geometry and restrained live-weather typography. */
#wyDailySheet {font-family:var(--wy-font);padding-top:4px}
#wyDailySheet .wyBar {gap:7px;margin-bottom:7px;padding:6px 0}
#wyDailySheet button {min-height:34px;padding:6px 10px;border:1px solid var(--wy-border);border-radius:var(--wy-radius);font:13px var(--wy-font);line-height:20px;background:#fff;color:var(--wy-text)}
#wyDailySheet button:hover {background:var(--wy-hover);border-color:#93AAA0}
#wyDailySheet button.wyPrimary {background:var(--wy-accent);border-color:var(--wy-accent);color:#fff}
#wyDailySheet button.wyPrimary:hover {background:var(--wy-accent-hover)}
#wyDailySheet .wyOriginalActions {gap:7px}
#wyDailySheet button.wyOriginalAction {padding:6px 14px;background:#E6EEE9;border:1px solid #C3D1CA;border-radius:var(--wy-radius);color:#1F403A;font:600 13px var(--wy-font);line-height:20px;box-shadow:none}
#wyDailySheet button.wyOriginalAction:hover {background:#D9E6DF;border-color:#9DB5A9}
#wyDailySheet .wyCalendarInput {height:34px;padding:6px;border-radius:var(--wy-radius);background:#fff;color:var(--wy-text);font:600 13px var(--wy-font)}
#wyDailySheet .wyWeatherSlot {margin-left:auto}
#wyDailySheet .wyWeather {gap:8px;font:600 15px var(--wy-font);line-height:1.3;font-variant-numeric:tabular-nums}
#wyDailySheet .wyWeatherIcons {padding:2px 5px;border-radius:3px}
#wyDailySheet .wyWeatherLive {font-size:11px}
#wyDailySheet .wyWeatherWarning img {width:28px;height:28px}
#wyDailySheet .wyStatus {padding:3px 0;margin:0 0 6px;background:transparent;color:var(--wy-muted);font-size:12px;line-height:1.5}
#wyDailySheet .wyStatus.wyError {padding:8px 10px;background:#fff0eb;color:#943d2c;border-radius:var(--wy-radius)}
#wyDailySheet .wyDate {margin:2px 0 5px;font-size:13px;line-height:1.4}

/* 4. Preserve rowspans, status colors and 45px timetable rows. */
#wyDailySheet th {height:44px;font-size:13px;line-height:1.35;font-weight:600}
#wyDailySheet .wyHeaderZh {margin-top:2px;font-size:12px;line-height:1.3;font-weight:400}
#wyDailySheet .wyTime {background:var(--wy-soft);color:#3F524E;font-size:12px;font-variant-numeric:tabular-nums}
#wyDailySheet .wyBooking {grid-template-rows:18px 18px;gap:1px 3px;line-height:18px}
#wyDailySheet .wyBooking .wyBookingUnit {font-size:14px;font-weight:700}
#wyDailySheet .wyBooking .wyBookingTime {font-size:11px}
#wyDailySheet .wyBooking .wySport {font-size:12px}
#wyDailySheet .wyBooking .wyPayment {font-size:11px;line-height:16px}
#wyDailySheet .wyFixedGrey {background:#E9EBE7!important}
#wyDailySheet .wyBlockedCell {background:#DADDD8!important}
#wyDailySheet .wyBlocked {color:#36443F}
#wyDailySheet .wyBlockRemark {font-size:12px;line-height:1.25}
#wyDailySheet .wyBlocked small {font-size:11px;line-height:1.25}
#wyDailySheet .wyInactive {margin-top:14px;color:var(--wy-muted);font-size:12px}
#wyDailySheet .wyInactiveTitle {margin-bottom:6px;font-weight:600}
#wyDailySheet .wyInactive p {margin:4px 0}

/* 5. Detail dialogs and date picker. Native show/hide and form layout stay intact. */
#wyDailySheet .wyHoverDetails,#wyDailySheet .wyCard,#wyDailySheet .wyBlockingCard {border:1px solid var(--wy-border);border-radius:9px;box-shadow:var(--wy-shadow)}
#wyDailySheet .wyHoverDetails {font:13px var(--wy-font);line-height:1.5}
#wyDailySheet .wyCard h3 {font-size:18px;color:var(--wy-accent)}
#wyDailySheet .wyBlockingBar button {background:#ffffff18;border-color:#ffffff66;color:#fff}
#wyDailySheet .wyBlockingBar button:hover {background:#ffffff30;border-color:#fff}
#ui-datepicker-div {padding:8px;border:1px solid var(--wy-border);border-radius:8px;background:#fff;box-shadow:var(--wy-shadow);font:13px var(--wy-font)}
#ui-datepicker-div .ui-datepicker-header {border:0;border-radius:5px;background:var(--wy-soft);color:var(--wy-accent)}
#ui-datepicker-div th {color:var(--wy-muted)}
#ui-datepicker-div td a {padding:5px;border:0;border-radius:4px;background:#fff;color:var(--wy-text);text-align:center}
#ui-datepicker-div td a:hover {background:var(--wy-hover)}
#ui-datepicker-div td .ui-state-highlight {background:#E6EEE9;color:var(--wy-accent);font-weight:bold}
#ui-datepicker-div td .ui-state-active {background:var(--wy-accent);color:#fff}
@media (max-width:1100px) {
  #wyDailySheet .wyWeatherSlot {flex-basis:100%;margin-left:0;justify-content:flex-start}
  #wyDailySheet .wyWeather {font-size:14px}
}
@media (prefers-reduced-motion:reduce) {.clsMenuBar #menuLeft a {transition:none}}
@media print {
  .clsMenuBar {display:none!important}
  .clsMasterHead:has(#wyNineDayForecast) {display:none!important}
  #wyDailySheet .wyBar {display:none!important}
  #wyDailySheet th,#wyDailySheet td {-webkit-print-color-adjust:exact;print-color-adjust:exact}
}


/* Inactive list uses its own column widths; never inherits the time-column width. */
#wyDailySheet .wyInactive[hidden] {display:none!important}
#wyDailySheet .wyInactive table {min-width:1000px}
#wyDailySheet .wyInactive th:first-child {width:190px}
#wyDailySheet .wyInactive th:nth-child(2) {width:24%}
#wyDailySheet .wyInactive th:nth-child(3) {width:110px}
#wyDailySheet .wyInactive th:nth-child(4) {width:140px}
#wyDailySheet .wyInactive td {padding:7px 8px;line-height:1.5;word-break:normal;overflow-wrap:anywhere}
#wyDailySheet .wyInactive td:first-child {white-space:nowrap;overflow-wrap:normal;word-break:normal}
#wyDailySheet button.wyInactiveRecord {min-height:28px;padding:2px 4px;border:0;border-radius:3px;background:transparent;color:var(--wy-accent);font-size:12px;font-weight:600;white-space:nowrap;word-break:normal;overflow-wrap:normal;text-decoration:underline;text-underline-offset:3px}
#wyDailySheet button.wyInactiveRecord:hover {background:var(--wy-hover)}
#wyNineDayForecast .wyForecastHeading {align-items:center}
#wyNineDayForecast .wyStatus {margin-left:auto;min-width:0;max-width:100%;padding:0;background:transparent;color:var(--wy-muted);font:normal 11px var(--wy-font);line-height:1.5;white-space:normal;overflow-wrap:anywhere}
#wyNineDayForecast .wyStatus.wyError {padding:4px 8px;background:#fff0eb;color:#943d2c;border-radius:4px}
@media(max-width:900px) {#wyNineDayForecast .wyStatus {flex-basis:100%;margin-left:0}}


/* Align every TreeView label to the same left edge; keep native toggle cells. */
.clsMenuBar #menuLeft div[id$="Nodes"] {margin-left:0!important;padding-left:0!important}
.clsMenuBar #menuLeft td:has(>div[style*="width:20px"]) {display:none!important}
.clsMenuBar #menuLeft td:not(:has(>a.menuLeft_0)):not(:has(>div)) {width:18px!important;min-width:18px!important;max-width:18px!important;padding-inline:0!important}
.clsMenuBar #menuLeft td:has(>a.menuLeft_0) {padding-left:0!important;text-align:left!important}

/* CMS has two legacy loading systems: processPanel and progress.gif overlays.
   This userscript only runs on FacilityBooking.aspx. Do not hide standalone
   .clsOpacityBackground: those backdrops belong to booking/error dialogs. */
#processPanel,.clsProcessBox,.clsLoadingBox,.clsOpacityBackgroundWithLoading {display:none!important;visibility:hidden!important;pointer-events:none!important}

/* Keep the loading indicator visible until requests and browser paint finish. */
#wyDailySheet .wySheetBody {position:relative;min-height:180px}
#wyDailySheet .wyScheduleLoading {position:absolute;inset:0;z-index:40;display:flex;align-items:flex-start;justify-content:center;padding:70px 16px 16px;background:transparent;cursor:progress;box-sizing:border-box}
#wyDailySheet .wyScheduleLoading[hidden] {display:none!important}
#wyDailySheet .wyLoadingCard {position:sticky;top:24px;display:flex;align-items:center;gap:12px;padding:16px 22px;border:1px solid var(--wy-border);border-radius:8px;background:#fff;box-shadow:0 4px 18px #1e2b2a14;color:var(--wy-text);font:14px var(--wy-font)}
#wyDailySheet .wyLoadingSpinner {width:22px;height:22px;flex:0 0 22px;border:3px solid var(--wy-border);border-top-color:var(--wy-accent);border-radius:50%;animation:wyScheduleSpin .8s linear infinite}
@keyframes wyScheduleSpin {to {transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce) {#wyDailySheet .wyLoadingSpinner {animation:none}}
`;
  document.head.appendChild(style);

/* 貼在腳本原有 document.head.appendChild(style); 的下一行即可。 */
style.textContent += `
/* BOOKING form UI v2.1 · append after the existing style block.
   Scope only the native FacilityBooking editor, keeping all original handlers,
   field visibility, readonly states, select options and validation. */
.pop-panel.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) {
  --wy-form-text:var(--wy-text,#1E2B2A);
  --wy-form-muted:var(--wy-muted,#5C6B68);
  --wy-form-accent:var(--wy-accent,#234B43);
  --wy-form-border:var(--wy-border,#CBD3D0);
  position:fixed!important;top:16px!important;left:50%!important;right:auto!important;bottom:auto!important;
  transform:translateX(-50%);margin:0!important;width:min(960px,calc(100vw - 32px))!important;
  height:auto!important;max-height:calc(100vh - 32px)!important;overflow:auto!important;
  padding:0!important;border:1px solid var(--wy-form-border)!important;border-radius:3px!important;
  background:#fff!important;color:var(--wy-form-text);box-shadow:0 18px 60px #1e2b2a40!important;
  font:13px var(--wy-font);box-sizing:border-box;
}
/* Short alias through :is keeps each rule scoped without adding JS classes. */
:is(.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"])) * {box-sizing:border-box}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .btn-close {
  position:absolute!important;top:16px!important;right:18px!important;left:auto!important;width:28px!important;height:28px!important;padding:5px!important;object-fit:contain;background:#ffffff16;border-radius:5px;z-index:3;cursor:pointer;
}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] {width:100%!important;margin:0!important;padding:0!important;color:var(--wy-form-text,#1E2B2A);font:13px var(--wy-font)}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable {width:100%!important;margin:0!important;padding:0!important;border:0!important;background:#fff}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .title-bar {
  height:auto!important;min-height:50px;padding:14px 52px 14px 20px!important;background:var(--wy-form-accent,#234B43)!important;border:0!important;color:#fff!important;
}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .title-bar .title {float:none!important;height:auto!important;margin:0!important;padding:0!important;color:#fff!important;font:600 16px var(--wy-font)!important;line-height:22px!important;letter-spacing:1px!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items {display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:13px 24px;padding:18px 20px!important;margin:0!important;float:none!important;width:100%!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items > .field {float:none!important;clear:none!important;width:auto!important;min-width:0;margin:0!important;padding:0!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items > .field > .field-label {display:block;float:none!important;width:100%!important;margin:0 0 5px!important;padding:0!important;color:var(--wy-form-muted,#5C6B68)!important;font:600 12px var(--wy-font)!important;line-height:18px!important;text-align:left!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items > .field > .field-label:empty {display:none}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .field-input {float:none!important;width:100%!important;min-width:0;max-width:100%;margin:0!important;padding:0!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] :is(select,input[type=text],input:not([type]),textarea) {width:100%!important;max-width:100%!important;min-width:0;border:1px solid var(--wy-form-border,#CBD3D0)!important;border-radius:3px!important;padding:7px 10px!important;background-color:#fff;color:var(--wy-form-text,#1E2B2A);font:13px var(--wy-font)!important;line-height:20px!important;box-shadow:none}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] :is(select:not([multiple]),input[type=text],input:not([type])) {height:36px!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] :is(input,select,textarea):focus-visible {outline:2px solid #2D6A8F!important;outline-offset:1px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] :is(input,select,textarea):disabled {background-color:#EFF2EF;color:#7B8884;cursor:not-allowed}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] input[readonly] {background-color:#EFF3F0;color:var(--wy-form-accent,#234B43);font-weight:600!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] input[type=checkbox] {width:16px!important;height:16px!important;margin:2px 0!important;vertical-align:middle;accent-color:var(--wy-form-accent,#234B43)}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items > :is(.unit,.resident-name,.resident-name-ddl,.resident-card,.IsForgotResidentCard,.remarks,.report,.Status) {grid-column:1 / -1}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .unit > .field-input {display:flex;gap:8px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .unit .field {flex:1 1 0;float:none!important;width:auto!important;min-width:0;margin:0!important;padding:0!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .span-message {display:inline-block;margin-top:4px;color:var(--wy-form-muted,#5C6B68);font-size:11px;line-height:16px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .resident-name br {display:none}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker-inline {width:100%!important;max-width:320px;padding:8px!important;border:1px solid var(--wy-form-border,#CBD3D0);border-radius:3px;background:#F7F9F7;font:13px var(--wy-font)}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker-header {border:0;background:#E7EEEA;color:var(--wy-form-accent,#234B43);border-radius:4px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker table {width:100%!important;min-width:0!important;font-size:12px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker td {padding:2px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker td :is(a,span) {padding:5px;text-align:center;border:0;border-radius:4px;background:#fff;color:var(--wy-form-text,#1E2B2A)}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker td.holiday:not(.ui-state-disabled) a {color:#B4412F}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker td a.ui-state-active {background:var(--wy-form-accent,#234B43)!important;color:#fff!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker td a:hover {background:#DDE8E1}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] select[multiple] {height:248px!important;padding:5px!important;overflow:auto}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] select[multiple] option {padding:4px 7px;font-size:12px;line-height:18px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] select[multiple] option:disabled {color:#8A9591;background:#F3F5F2}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] textarea {height:76px!important;min-height:76px;resize:vertical}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .last-field {display:none!important}
/* Additional-charge grid and native icon controls remain in their original scope. */
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge {width:calc(100% - 40px)!important;margin:0 20px 16px!important;padding:0!important;border-top:1px solid var(--wy-form-border,#CBD3D0)}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge .clsGridHeader {background:#fff!important;color:var(--wy-form-accent,#234B43);height:auto!important;min-height:40px}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge .title {color:var(--wy-form-accent,#234B43)!important;font:600 13px var(--wy-font)!important;letter-spacing:.5px!important;line-height:40px!important}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge .btn-footer {background-color:var(--wy-form-accent,#234B43)!important;border-radius:4px;border:0}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge table {width:100%!important;min-width:0!important;font:12px var(--wy-font);border-collapse:collapse}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge th {background-color:var(--wy-form-accent,#234B43)!important;color:#fff!important;padding:8px 6px!important;font-weight:600}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge td {border-color:var(--wy-form-border,#CBD3D0);padding:7px 6px!important}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .footer.buttons {position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:8px;float:none!important;width:100%!important;margin:0!important;padding:12px 20px!important;border-top:1px solid var(--wy-form-border,#CBD3D0);background:#fff;z-index:2}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .footer.buttons .btn {float:none!important;min-width:92px;min-height:36px;padding:7px 18px!important;border:1px solid var(--wy-form-border,#CBD3D0)!important;border-radius:3px;background:#E7EEEA!important;color:var(--wy-form-accent,#234B43)!important;font:600 13px var(--wy-font)!important;cursor:pointer}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .footer.buttons :is(.btn-save,.btn-booking,.btn-confirm) {background:var(--wy-form-accent,#234B43)!important;border-color:var(--wy-form-accent,#234B43)!important;color:#fff!important}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .footer.buttons .btn:disabled {opacity:.45;cursor:not-allowed}
@media(max-width:640px) {
  .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items {grid-template-columns:minmax(0,1fr);gap:12px;padding:14px!important}
  .clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge {width:calc(100% - 28px)!important;margin-inline:14px!important;overflow-x:auto}
  .clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge table {min-width:520px!important}
  .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker-inline {max-width:none}
}


/* Native plugin uses different primary button classes for create/edit/confirm. */
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .footer.buttons :is(.btn-save,.btn-booking,.btn-confirm):hover {background:#183630!important;color:#fff!important}
/* Remove the legacy vertical scroll areas; the dialog remains the scroll owner. */
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge,
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge > .clsGridTable {height:auto!important;max-height:none!important;min-height:0!important;overflow:visible!important}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge .list-items {height:auto!important;max-height:none!important;min-height:0!important;overflow-x:auto!important;overflow-y:hidden!important}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge .edithr {display:none}

/* Compact booking: hide unused UI without removing data fields or native handlers. */
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items > :is(.IsForgotResidentCard,.RefNo,.guest,.deposit) {display:none!important}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .search-page-additional-charge {display:none!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items {gap:10px 20px;padding:16px 20px!important;align-items:start}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items > .source {grid-column:1 / -1}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .source select {max-width:280px!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .date .ui-datepicker-inline {max-width:none}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] select[multiple] {height:232px!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] textarea {height:64px!important;min-height:64px}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .footer.buttons .wyBookingCancel {background:#fff!important;color:var(--wy-form-accent,#234B43)!important;border-color:var(--wy-form-border,#CBD3D0)!important}
.clsInputDialog:has(> .edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]) > .footer.buttons .wyBookingCancel:hover {background:#E7EEEA!important}

/* Existing booking details are compact, while new bookings retain the calendar. */
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] > .clsGridTable > .record-items > .report {display:none!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] :is(.btn-preview,.btn-report) {display:none!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"].wyExistingBooking .facility-date-pick {display:none!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .wyBookingDateText {display:none}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"].wyExistingBooking .wyBookingDateText,
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"].wyExistingBooking .strTime {display:block;padding:7px 10px;min-height:36px;width:100%;border:1px solid var(--wy-form-border,#CBD3D0);border-radius:3px;background:#EFF3F0;color:var(--wy-form-text,#1E2B2A);font-size:13px;line-height:20px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"].wyBlockResident .unit .field.floor {display:none!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"].wyExistingBooking .span-message {display:none}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status > .field-input {display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status > .field-input > .field-input {width:auto!important;flex:1 1 220px;margin:0!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status .status-bg {width:auto!important;min-width:100px;min-height:30px;padding:5px 12px;border-radius:5px;background:#E7EEEA!important;color:var(--wy-form-accent,#234B43)!important;font-size:13px;line-height:20px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status .blue {color:var(--wy-form-muted,#5C6B68);font-size:11px;line-height:18px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"].wyExistingBooking :is(select:disabled,input:disabled) {color:#44524F;background-color:#EFF3F0}

/* Use one Change To: the create-time choice for new bookings, native controls for existing records. */
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status.wyCreateStatus {display:block!important}
/* Native code can set display:block inline; override it only in create mode. */
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status.wyCreateStatus :is(.field-input.ddl-select,.status-bg) {display:none!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status.wyCreateStatus .wyAfterStatus {width:60%;margin-left:auto;margin-right:35px;flex-wrap:wrap}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status .wyAfterStatus {display:inline-flex;align-items:center;gap:8px;margin:0;color:var(--wy-form-muted,#5C6B68);font:600 12px var(--wy-font);letter-spacing:.3px}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status .wyAfterStatus[hidden] {display:none!important}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status .wyAfterStatus select {width:auto!important;min-width:130px;min-height:36px;padding:6px 10px;border:1px solid var(--wy-form-border,#CBD3D0);border-radius:3px;background:#fff;color:var(--wy-form-text,#1E2B2A);font:13px var(--wy-font)}
.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"] .Status .wyAfterStatus.wyAfterStatusOn select {border-color:var(--wy-lawn,#3E7D4F)!important;box-shadow:inset 3px 0 0 var(--wy-lawn,#3E7D4F);font-weight:600}

/* Quiet native steps and the save toast. */
html.wyQuietNative .panelEdit, html.wyQuietNative #processPanel {opacity:0!important;pointer-events:none!important}
#wyToast {position:fixed;left:50%;bottom:28px;z-index:2147483000;transform:translate(-50%,8px);padding:9px 18px;border-radius:3px;background:var(--wy-ink,#1E2B2A);color:#fff;font:600 13px var(--wy-font);box-shadow:var(--wy-shadow,0 10px 30px #1e2b2a29);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
#wyToast.wyToastShow {opacity:1;transform:translate(-50%,0)}
#wyToast.wyToastError {background:var(--wy-red,#B4412F);max-width:min(560px,90vw);text-align:center;line-height:1.5}
@media (prefers-reduced-motion:reduce) {#wyToast {transition:none}}

/* ───────── 1.3.67 · Drafting-sheet skin (visual layer only) ─────────
   One idea: a cell's state is read from its left edge, like a margin note on a plan.
   paid = lawn bar · pending = ochre bar · out of service = hatched · closed by schedule = flat grey.
   Geometry is untouched: 45px rows, 50px forecast cards, rowspans, scroll areas, handlers. */

/* Frame */
.clsMasterHead {background:var(--wy-soft)!important;border-bottom:1px solid var(--wy-ink)!important}
.clsMenuBar #menuLeft a.menuLeft_0 {border-radius:2px}
.clsMenuBar #menuLeft a.MenuSelected {box-shadow:inset 3px 0 0 #8CC2A0!important}

/* Forecast */
#wyNineDayForecast .wyForecastHeading {color:var(--wy-ink);font-weight:700;letter-spacing:.04em}
#wyNineDayForecast .wyForecastDay {padding:3px 6px;background:#fff;border:1px solid var(--wy-border);border-top:2px solid var(--wy-accent);border-radius:0 0 3px 3px}
#wyNineDayForecast .wyForecastDay:has(.wyForecastWeekend) {border-top-color:var(--wy-red)}
#wyNineDayForecast img {border-radius:3px}

/* Toolbar */
#wyDailySheet .wyBar {padding:6px 0 10px;border-bottom:1px solid var(--wy-border)}
#wyDailySheet button {border-color:#B7C2BD;font-weight:500}
#wyDailySheet button:hover {border-color:var(--wy-accent)}
#wyDailySheet button.wyPrimary {border-color:var(--wy-accent)}
#wyDailySheet button.wyOriginalAction {background:#fff;border-color:#B7C2BD;color:var(--wy-accent)}
#wyDailySheet button.wyOriginalAction:hover {background:var(--wy-hover);border-color:var(--wy-accent)}
#wyDailySheet .wyCalendarInput {border-color:#B7C2BD;font-weight:700}
#wyDailySheet .wyDate {margin:8px 0 10px;font-size:20px;line-height:1.3;font-weight:700;letter-spacing:.04em;color:var(--wy-ink)}
#wyDailySheet .wyWeatherIcons {border-radius:3px}
#wyDailySheet .wyStatus.wyError,#wyNineDayForecast .wyStatus.wyError {border-left:4px solid var(--wy-red);border-radius:0 3px 3px 0}
#wyDailySheet .wyWarning {background:#FBF1D4;border-left:4px solid var(--wy-ochre);border-radius:0 3px 3px 0}

/* Timetable */
#wyDailySheet table {border:1px solid var(--wy-ink)}
#wyDailySheet thead th {background:#fff;color:var(--wy-ink);border-bottom:2px solid var(--wy-ink);font-weight:700}
#wyDailySheet thead th:first-child {color:var(--wy-muted);font-weight:600}
#wyDailySheet .wyHeaderZh {color:var(--wy-muted);font-weight:500}
#wyDailySheet td.wyTime {background:var(--wy-soft);color:var(--wy-accent);font-weight:700;border-right:2px solid var(--wy-ink)}
#wyDailySheet td.wySettledCell {background:var(--wy-paid);box-shadow:inset 4px 0 0 var(--wy-lawn);padding-left:5px}
#wyDailySheet td.wyPendingCell {background:var(--wy-pending);box-shadow:inset 4px 0 0 var(--wy-ochre);padding-left:5px}
#wyDailySheet .wyBooking:hover {background:#1e2b2a0f}
/* Distinct Ref Nos remain distinct bookings. In mixed cells each booking owns
   its colour, so a real Pending neighbour cannot make the Paid booking yellow. */
#wyDailySheet td.wyMixedCell {background:#fff;box-shadow:none}
#wyDailySheet .wyMixedCell .wyBooking.wySettled {background:var(--wy-paid);box-shadow:inset 3px 0 0 var(--wy-lawn);padding-left:5px}
#wyDailySheet .wyMixedCell .wyBooking.wyPending {background:var(--wy-pending);box-shadow:inset 3px 0 0 var(--wy-ochre);padding-left:5px}
#wyDailySheet .wyBooking .wyBookingUnit {color:var(--wy-ink)}
#wyDailySheet .wyBooking .wySport {color:#44524F}
#wyDailySheet .wyPending .wyPayment {background:transparent;color:#8A5A00}
#wyDailySheet .wySettled .wyPayment {background:transparent;color:#1F5A33}
#wyDailySheet td.wyBlockedCell {background:repeating-linear-gradient(135deg,#DADDD8 0 7px,#CFD3CD 7px 8px)!important}
#wyDailySheet td.wyFixedGrey {background:#E9EBE7!important}
#wyDailySheet .wyBlocked {color:#2F3C38}
#wyDailySheet td.wyBookable:hover {background:#DCEBF4}
#wyDailySheet td.wyBookable.wyHoveredCell {background:#DCEBF4!important}

/* Floating panels */
#wyDailySheet .wyModal,#wyDailySheet .wyBlockingOverlay {background:rgba(30,43,42,.5)}
#wyDailySheet .wyCard {border-radius:5px;border-top:3px solid var(--wy-accent)}
#wyDailySheet .wyBlockingCard {border-radius:5px}
#wyDailySheet .wyHoverDetails {border-radius:4px;border-left:4px solid var(--wy-accent)}
#ui-datepicker-div {border-radius:4px;border-color:var(--wy-ink)}

@media print {
  #wyDailySheet td.wySettledCell {border-left:4px solid var(--wy-lawn)}
  #wyDailySheet td.wyPendingCell {border-left:4px solid var(--wy-ochre)}
}
`;

/* Resident rules and Cancel use the native controls and close handler. */
(function wyBookingFormEnhancements() {
  'use strict';
  const editorSelector='.edit-page-details[data-save*="FacilityBookingServices.asmx/FacilityBooking"]';
  const installed=new WeakMap(), controllers=new Set();
  function blockKind(control) {
    const text=String(control?.selectedOptions?.[0]?.textContent||'').trim();
    if(/^Block\s+[A-F]$/i.test(text))return 'block';
    const tower=/^Tower\s+(\d+)$/i.exec(text);
    return tower && Number(tower[1])>=1 && Number(tower[1])<=999 ? 'tower' : '';
  }
  function towerFloor(option) {return /^(?:G|[1-7])\s*\/\s*F$/i.test(option.textContent.trim());}
  function towerFlat(option) {return /^Flat\s+[A-F]$/i.test(option.textContent.trim());}
  // Native floor values: 0 = LG/F & G/F; 1 = 1/F-3/F; 2 = 1/F & 2/F.
  // For Block A-F, the unit determines the hidden floor; no unit means no floor.
  function blockUnitFloor(control,block) {
    const text=String(control?.selectedOptions?.[0]?.textContent||'').trim();
    const unit=/^Unit\s*([PG])\s*(\d{1,2})$/i.exec(text);
    if(!unit || Number(unit[2])<1 || Number(unit[2])>17)return '';
    if(unit[1].toUpperCase()==='G')return '0';
    const building=String(block?.selectedOptions?.[0]?.textContent||'').trim();
    return /^Block\s+[CF]$/i.test(building)?'2':'1';
  }
  function filterOptions(control,allow,originals) {
    if(!control)return false;
    const previous=control.value;
    for(const option of control.options) {
      if(!originals.has(option))originals.set(option,{hidden:option.hidden,disabled:option.disabled});
      const original=originals.get(option),excluded=allow && option.value!=='' && !allow(option);
      option.hidden=original.hidden || !!excluded;
      option.disabled=original.disabled || !!excluded;
    }
    const selected=control.selectedOptions[0];
    if(selected && (selected.disabled || selected.hidden)) {
      const blank=Array.from(control.options).find(o=>o.value==='' && !o.disabled && !o.hidden);
      if(blank)control.value='';else control.selectedIndex=-1;
    }
    return control.value!==previous;
  }
  function bookingDateText(picker,jq) {
    let date;
    try {if(picker && jq?.fn?.datepicker)date=jq(picker).datepicker('getDate');}catch {}
    if(date && Number.isFinite(date.getTime()))return String(date.getDate()).padStart(2,'0')+'/'+String(date.getMonth()+1).padStart(2,'0')+'/'+date.getFullYear();
    const cell=picker?.querySelector('.ui-datepicker-current-day[data-year][data-month]');
    const selected=cell?.querySelector('.ui-state-active');
    if(selected) {
      const y=Number(cell.getAttribute('data-year')),m=Number(cell.getAttribute('data-month')),d=Number(selected.textContent);
      const parsed=new Date(y,m,d);
      if(y>=1000 && parsed.getFullYear()===y && parsed.getMonth()===m && parsed.getDate()===d)return String(d).padStart(2,'0')+'/'+String(m+1).padStart(2,'0')+'/'+y;
    }
    return '—';
  }
  function attach(editor) {
    if(installed.has(editor))return;
    const dialog=editor.closest('.clsInputDialog');
    if(!dialog)return;
    const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
    const jq=page.jQuery;
    const originals=new WeakMap();
    // Option shown as "G/F" while it is really the native "LG/F & G/F": option -> its own native text.
    const relabelled=new WeakMap();
    let timer,stopped=false;
    const select=name=>editor.querySelector('select[name="'+name+'"]');
    const change=control=>{if(jq)jq(control).trigger('change');else control.dispatchEvent(new Event('change',{bubbles:true}));};
    const selectedText=control=>String(control?.selectedOptions?.[0]?.textContent||'').trim();
    const nativeText=option=>String(relabelled.get(option)??option.textContent).trim();
    // Tower 25 only: ground-floor flats A-D sit on the native "LG/F & G/F" floor (value 0).
    // The floor list keeps showing "G/F", but the selected option is the native LG/F & G/F one.
    // Flat E/F (or any other flat/floor/tower) goes back to the plain G/F option.
    function groundFlatFloor(kind,block,floor,flat) {
      const none={changed:false,hide:null};
      if(!floor)return none;
      const options=Array.from(floor.options);
      const lg=options.find(o=>/^LG\s*\/\s*F\s*&\s*G\s*\/\s*F$/i.test(nativeText(o)));
      const ground=options.find(o=>o!==lg && /^G\s*\/\s*F$/i.test(nativeText(o)));
      if(!lg || !ground)return none;
      const selected=floor.selectedOptions[0];
      const shown=relabelled.has(lg);
      const onGround=selected===ground || (shown && selected===lg);
      const wanted=kind==='tower' && /^Tower\s+25$/i.test(selectedText(block)) && /^Flat\s+[A-D]$/i.test(selectedText(flat)) && onGround;
      if(wanted) {
        if(!shown){relabelled.set(lg,lg.textContent);lg.textContent=ground.textContent.trim();}
        const original=originals.get(lg);
        lg.hidden=original?original.hidden:false;
        lg.disabled=original?original.disabled:false;
        const changed=selected!==lg;
        if(changed)lg.selected=true;
        return {changed,hide:ground};
      }
      if(shown) {
        const wasSelected=selected===lg;
        lg.textContent=relabelled.get(lg);
        relabelled.delete(lg);
        if(wasSelected){ground.selected=true;return {changed:true,hide:null};}
      }
      return none;
    }
    // Create-time status. The booking is still created natively (Pending); the choice is only remembered
    // here and carried out after save-success. The select has no name, so it does
    // not replace or submit the native strStatus field.
    let wasVisible=false;
    function resetAfterStatus() {
      const field=dialog.querySelector('.wyAfterStatus');
      const control=field?.querySelector('select');
      if(control&&control.value){control.value='';field.classList.remove('wyAfterStatusOn');}
      delete editor.dataset.wyAfter;
    }
    function ensureAfterStatus(existing) {
      let row=editor.querySelector('.field.Status');
      if(!row && !existing) {
        const items=editor.querySelector('.record-items');
        if(!items)return;
        row=document.createElement('div');row.className='field Status';
        const title=document.createElement('div');title.className='field-label';title.textContent='Status';
        const input=document.createElement('div');input.className='field-input';
        row.append(title,input);items.appendChild(row);
      }
      if(!row)return;
      row.classList.toggle('wyCreateStatus',!existing);
      const nativeChoice=row.querySelector('.field-input.ddl-select');
      const holder=nativeChoice?.parentElement || row.querySelector(':scope > .field-input');
      if(!holder)return;
      let field=dialog.querySelector('.wyAfterStatus');
      if(!field) {
        field=document.createElement('label');field.className='wyAfterStatus';
        const text=document.createElement('span');text.textContent='Change To';
        const control=document.createElement('select');
        for(const [value,label] of [['','Pending'],['PAID','Settled']]) {
          const option=document.createElement('option');option.value=value;option.textContent=label;control.appendChild(option);
        }
        control.value='';
        control.addEventListener('change',()=>field.classList.toggle('wyAfterStatusOn',!!control.value));
        field.append(text,control);
      }
      if(nativeChoice) {
        if(nativeChoice.nextElementSibling!==field)nativeChoice.after(field);
      } else if(field.parentElement!==holder)holder.appendChild(field);
      field.hidden=!!existing;
      if(existing)resetAfterStatus();
    }
    function rememberAfterStatus(event) {
      if(!event.target.closest?.('.btn-booking'))return;
      // Capture runs before native SAVE handlers. A second click must not reach
      // them or overwrite the first submission's remembered settlement plan.
      if(bookingSave) {
        event.preventDefault();event.stopImmediatePropagation();return;
      }
      const status=dialog.querySelector('.wyAfterStatus select')?.value;
      delete editor.dataset.wyAfter;
      beginBookingSave(editor);
      if(!status)return;
      const date=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bookingDateText(editor.querySelector('.facility-date-pick'),jq));
      const first=select('strTime')?.selectedOptions?.[0];
      const time=/(\d{1,2}:\d{2})\s*[-–]\s*\d{1,2}:\d{2}/.exec((first?.value||'')+' '+(first?.textContent||''));
      if(!date||!time)return;
      editor.dataset.wyAfter=JSON.stringify({
        status,date:date[3]+'-'+date[2]+'-'+date[1],start:time[1],
        facility:selectedText(select('strFacilityID')),venue:selectedText(select('strVenueID'))
      });
    }
    dialog.addEventListener('click',rememberAfterStatus,true);
    function addCancel() {
      const footer=Array.from(dialog.children).find(e=>e.classList.contains('footer')&&e.classList.contains('buttons'));
      if(!footer || footer.querySelector('.wyBookingCancel'))return;
      const cancel=document.createElement('button');
      cancel.type='button';cancel.className='btn wyBookingCancel';cancel.textContent='Close';
      cancel.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        Array.from(dialog.children).find(e=>e.classList.contains('btn-close'))?.click();
      });
      footer.insertBefore(cancel,footer.firstChild);
    }
    function updateDate(existing) {
      const holder=editor.querySelector('.field.date > .field-input');
      if(!holder)return;
      let text=holder.querySelector('.wyBookingDateText');
      if(!existing)return;
      if(!text){text=document.createElement('div');text.className='wyBookingDateText';holder.appendChild(text);}
      const date=bookingDateText(holder.querySelector('.facility-date-pick'),jq);
      if(text.textContent!==date)text.textContent=date;
    }
    function update() {
      if(stopped || !editor.isConnected)return;
      addCancel();
      // Restrict dependent choices only for a new booking; preserve saved record data.
      const existing=editor.querySelector('[name="strFacilityBookingID"]')?.value;
      const block=select('strBlock'),floor=select('strFloor'),flat=select('strFlat');
      const kind=existing?'':blockKind(block);
      editor.classList.toggle('wyExistingBooking',!!existing);
      editor.classList.toggle('wyBlockResident',kind==='block');
      updateDate(!!existing);
      ensureAfterStatus(!!existing);
      const visible=!!(dialog.offsetWidth||dialog.offsetHeight);
      if(wasVisible && !visible)resetAfterStatus();
      wasVisible=visible;
      const ground=groundFlatFloor(kind,block,floor,flat);
      const floorChanged=filterOptions(floor,kind==='tower'?(o=>towerFloor(o) && o!==ground.hide):null,originals) || ground.changed;
      const flatChanged=filterOptions(flat,kind==='tower'?towerFlat:kind==='block'?o=>!towerFlat(o):null,originals);
      let unitFloorChanged=false;
      if(kind==='block' && floor) {
        const wanted=blockUnitFloor(flat,block);
        const option=Array.from(floor.options).find(o=>o.value===wanted&&!o.disabled&&!o.hidden);
        const previous=floor.value;
        // Async option reloads are retried by the existing child-list observer.
        if(option)floor.value=option.value;else floor.selectedIndex=-1;
        unitFloorChanged=floor.value!==previous;
      }
      // Notify the native resident lookup after the hidden floor is up to date.
      if(floorChanged || unitFloorChanged)change(floor);
      if(flatChanged)change(flat);
    }
    function schedule(){clearTimeout(timer);timer=setTimeout(update,100);}
    // jQuery is needed for native programmatic .trigger('change') events.
    if(jq)jq(editor).on('change.wyBookingFormV2','select[name="strBlock"],select[name="strFloor"],select[name="strFlat"]',schedule);
    else editor.addEventListener('change',schedule);
    const observer=new MutationObserver(schedule);
    observer.observe(editor,{childList:true,subtree:true});
    const visibilityObserver=new MutationObserver(schedule);
    visibilityObserver.observe(dialog.parentElement||dialog,{attributes:true,attributeFilter:['class','style','hidden']});
    const controller={detached:()=>!editor.isConnected,stop(){stopped=true;clearTimeout(timer);observer.disconnect();dialog.removeEventListener('click',rememberAfterStatus,true);visibilityObserver.disconnect();installed.delete(editor);for(const control of [select('strFloor'),select('strFlat')])for(const option of control?.options||[]){const original=originals.get(option);if(original){option.hidden=original.hidden;option.disabled=original.disabled;}if(relabelled.has(option)){option.textContent=relabelled.get(option);relabelled.delete(option);}}if(jq)jq(editor).off('.wyBookingFormV2');else editor.removeEventListener('change',schedule);}};
    installed.set(editor,controller);controllers.add(controller);update();
  }
  function scan() {
    for(const editor of document.querySelectorAll(editorSelector))attach(editor);
  }
  const observer=new MutationObserver(()=>{
    for(const controller of controllers)if(controller.detached?.()){controller.stop();controllers.delete(controller);}
    scan();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  scan();
  window.addEventListener('pagehide',()=>{observer.disconnect();for(const controller of controllers)controller.stop();},{once:true});
})();







  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function button(text, fn, cls) {
    const b = el('button', text, cls);
    b.type = 'button';
    b.onclick = fn;
    return b;
  }

  function getPageWindow() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function identity() {
    const estate = root.querySelector('[name=strEstate]')?.value;
    const user = root.querySelector('[name=strCurrentUser]')?.value;

    if (!estate || !user) {
      throw Error('找不到目前登入的屋苑或使用者，請重新登入。');
    }
    return { estate, user };
  }

  function say(text, error = false) {
    status.textContent = text;
    status.className = 'wyStatus' + (error ? ' wyError' : '');
  }

  function setScheduleLoading(active, selected) {
    // Creating, settling and refreshing share one uninterrupted loading overlay.
    active = active || !!bookingSave;
    selected = selected || dateInput.value;
    panel.setAttribute('aria-busy', String(active));
    loadingOverlay.hidden = !active;
    if (active) {
      hideHoverDetails();
      hideGridLocator();
      loadingLabel.textContent = '正在更新 ' + C.dmy(selected) + ' 時間表…';
    }
  }

  function waitForSchedulePaint() {
    // Two frames allow layout and a painted frame after the final DOM update.
    // A hidden tab has no visible frame to wait for and may pause animation frames.
    return new Promise(resolve => {
      if (document.hidden) setTimeout(resolve, 0);
      else requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function invoke(method, payload, signal, api = API) {
    const response = await fetch(api + method, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal
    });

    const label = (api.includes('NoServices.asmx') ? 'Out of Service' : 'Booking')+' / '+method;
    const text = await response.text();
    const origin = window.location?.origin || 'https://apps.nwd.com.hk';
    const finalURL = new URL(response.url || api+method, origin);
    if (finalURL.origin !== origin) throw Error(label+'：查詢被導向另一網站，已停止讀取。');
    if (response.status === 401) throw Error(label+'：伺服器未通過身份驗證（HTTP 401）。');
    if (response.status === 403) throw Error(label+'：伺服器拒絕存取（HTTP 403），請檢查此頁面的權限。');
    if (/^\s*</.test(text)) {
      const login = /(?:login|logon|signin)/i.test(finalURL.pathname) ||
        /<input\b[^>]*type\s*=\s*["']?password\b/i.test(text);
      if (login) throw Error(label+'：查詢實際被導向登入頁，請重新登入原系統。');
      throw Error(label+'：收到網站 HTML '+(response.redirected?'重新導向':'回應')+
        '（HTTP '+response.status+'；'+finalURL.pathname+'），不是預訂資料。');
    }
    if (!response.ok) {
      let message = '';
      try {message = String(JSON.parse(text).Message || '').slice(0,180);} catch {}
      throw Error(label+'：查詢失敗（HTTP '+response.status+'）'+(message?'；'+message:''));
    }
    try {return JSON.parse(text);}
    catch {throw Error(label+'：伺服器回應不是有效 JSON。');}
  }

  const BLOCKING_API='/CMS/services/NoServices.asmx/';
  async function queryBlockingGroups(who, groupID='', signal) {
    const response = await invoke('GetFacilityNoServiceByCriteria', {
      strFacilityID:'', strEventID:'', strSearch:'', strDateFrom:'', strDateTo:'',
      strNoServiceGroupID:String(groupID), strEstate:who.estate, strCurrentUser:who.user
    }, signal, BLOCKING_API);
    // The native unfiltered Out of Service list returns {"d":null} for zero groups.
    if (groupID === '' && response?.d === null && Object.keys(response).length === 1) return [];
    return C.rows(response, 'Out of Service / GetFacilityNoServiceByCriteria');
  }

  // NoServices search is unpaginated (data-pagination-max="0" in the original page).
  // Load all groups: date filters may omit recurring groups which started earlier.
  async function loadNoServices(who, selected, signal) {
    const records = await queryBlockingGroups(who, '', signal);
    const result = [];
    for (const r of records) {
      if (r.EstateID != null && String(r.EstateID) !== String(who.estate)) {
        throw Error('Out of Service 回傳了其他屋苑的記錄，已停止更新。');
      }
      const first = C.day(r.NoServiceDateFrom);
      const last = r.NoServiceDateTo == null || r.NoServiceDateTo === '' ? first : C.day(r.NoServiceDateTo);
      if (C.valid(first) && C.valid(last) && (selected < first || selected > last)) continue;
      // The list's visible cells do not include recurrence. Fetch details if needed;
      // never assume that a missing Week/Day means every day.
      if (!C.blockRuleReady(r) || !(r.FacilityName || r.NameEng) ||
          (r.VenueID && !C.venueName(r))) {
        if (r.NoServiceGroupID == null) throw Error('封鎖記錄缺少 NoServiceGroupID。');
        // The old page's data-load names a method absent from the live WSDL.
        // Use the actual search method's strNoServiceGroupID filter instead.
        const details = await queryBlockingGroups(who, r.NoServiceGroupID, signal);
        if (!details.length) throw Error('封鎖記錄 '+r.NoServiceGroupID+' 的規則未能讀取。');
        for (const detail of details) {
          if (detail.NoServiceGroupID != null && String(detail.NoServiceGroupID) !== String(r.NoServiceGroupID)) {
            throw Error('封鎖記錄詳情 ID 不符，已停止更新。');
          }
          if (detail.EstateID != null && String(detail.EstateID) !== String(who.estate)) {
            throw Error('封鎖記錄詳情屋苑不符，已停止更新。');
          }
          result.push({...r,...detail});
        }
      } else result.push(r);
    }
    return result;
  }

  let syncingDates = false, dateSyncTimer;
  function originalDateInputs() {
    return [root.querySelector('input[name="strDateFrom"]'), root.querySelector('input[name="strDateTo"]')];
  }
  function syncOriginalDates(selected, forceSearch = false) {
    const fields=originalDateInputs();
    if (fields.some(field=>!field)) return;
    const text=C.dmy(selected);
    const changed=fields.some(field=>field.value!==text);
    if (!changed && !forceSearch) return;
    syncingDates=true;
    try {
      const pageWindow=getPageWindow();
      const jq=pageWindow.jQuery;
      for (const field of fields) {
        if (field.classList.contains('hasDatepicker') && jq?.fn?.datepicker) jq(field).datepicker('setDate',text);
        field.value=text;
      }
      // The original search button refreshes the original list using its own filters.
      root.querySelector('.btnSearch')?.click();
    } finally { syncingDates=false; }
  }
  function queueOriginalDateSync() {
    if (syncingDates) return;
    clearTimeout(dateSyncTimer);
    dateSyncTimer=setTimeout(()=>{
      const [from,to]=originalDateInputs();
      if (!from || !to) return;
      const first=C.day(from.value.trim()), last=C.day(to.value.trim());
      // A daily sheet cannot represent a multi-day range; retain that range as entered.
      if (!C.valid(first) || first!==last) return;
      if (dateInput.value===first && shownDate===first) return;
      dateInput.value=first;
      load({searchOriginal:true});
    },150);
  }
  function installDateSync() {
    const fields=originalDateInputs();
    const pageWindow=getPageWindow();
    const jq=pageWindow.jQuery;
    for (const field of fields.filter(Boolean)) {
      field.addEventListener('input',queueOriginalDateSync);
      field.addEventListener('change',queueOriginalDateSync);
      if (jq?.fn?.on) jq(field).on('change.wyDailyDate',queueOriginalDateSync);
      if (field.classList.contains('hasDatepicker') && jq?.fn?.datepicker) {
        const previous=jq(field).datepicker('option','onSelect');
        jq(field).datepicker('option','onSelect',function(...args){
          if (typeof previous==='function') previous.apply(this,args);
          queueOriginalDateSync();
        });
      }
    }
    const [from,to]=fields;
    const day=from && C.day(from.value.trim());
    if (from && to && C.valid(day) && day===C.day(to.value.trim())) dateInput.value=day;
  }

  async function load(options = {}) {
    // Do not fetch an intermediate Pending state while native creation/settlement is running.
    if (bookingSave && !options?.afterBookingSave) return;
    const selected = dateInput.value;

    if (!C.valid(selected)) {
      say('請選擇有效日期。', true);
      return;
    }

    const run = ++serial;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    busy = true;
    scheduleReady = false;
    refreshButton.disabled = true;
    setScheduleLoading(true, selected);
    say('正在讀取 ' + C.dmy(selected) + ' 的全部分頁…');

    try {
      if (!options?.preserveRange) syncOriginalDates(selected, !!options?.searchOriginal);
      const who = identity();

      const base = {
        strFacilityID: null,
        strBlock: null,
        strFloor: null,
        strFlat: null,
        strStatus: null,
        strSearch: '',
        strDateFrom: C.dmy(selected),
        strDateTo: C.dmy(selected),
        strFacilityBookingID: '',
        strEstate: who.estate,
        strCurrentUser: who.user
      };

      const merged = new Map();
      const statuses = [null, 'CAN', 'EXPI'];
      for (const requestedStatus of statuses) {
      const query = {...base, strStatus:requestedStatus};
      const records = await C.collect(
        (start, end) => invoke(
          'GetFacliltyBookingWithSelectedRow',
          {
            ...query,
            strStartRow: String(start),
            strEndRow: String(end),
            strOrder: 'Created Date',
            strIsASC: '0'
          },
          signal
        ),
        () => invoke(
          'GetFacliltyBookingTotalNumber',
          { ...query, strFacilityID: '' },
          signal
        ),
        (n, total) => {
          if (run === serial) {
            say(
              '已讀取 ' + n + ' / ' +
              (total == null ? '未知' : total) + ' 筆…'
            );
          }
        }
      );

      for (const record of records) merged.set(String(record.FacilityBookingID ?? record.RefNo), record);
      }
      const all = Array.from(merged.values());
      if (run !== serial) return;
      say('正在讀取 Out of Service 封鎖時段及重複規則…');
      const blocks = await loadNoServices(who, selected, signal);
      // Validate before committing either dataset so a failed refresh keeps both old ones.
      const blockCheck = C.blockRows(blocks, selected);
      if (blockCheck.errors.length) throw Error(blockCheck.errors.join('；'));

      if (run !== serial) return;

      const now = identity();

      if (now.estate !== who.estate || now.user !== who.user) {
        throw Error('登入身份或屋苑已變更，請重新整理。');
      }

      data = all;
      noServiceData = blocks;
      scheduleReady = true;
      shownDate = selected;
      render();

      say(
        '已完整讀取 ' + all.length +
        ' 筆預訂；當日 Out of Service：' + blockCheck.rows.length + ' 筆。更新時間：' +
        new Date().toLocaleTimeString('zh-HK', {
          timeZone: 'Asia/Hong_Kong',
          hour12: false
        })
      );
    } catch (e) {
      if (run === serial && e.name !== 'AbortError') {
        scheduleReady = false;
        say(e.message + ' 尚未更新時間表；已暫停從時間表建立預訂，請重新讀取。', true);
      }
    } finally {
      if (run === serial) {
        await waitForSchedulePaint();
        // A newer date may have started loading during the paint wait.
        if (run === serial) {
          busy = false;
          refreshButton.disabled = !!bookingSave;
          setScheduleLoading(false);
        }
      }
    }
  }

  function paymentState(r) {
    const code = String(r.Status || '').trim().toUpperCase();
    const desc = String(r.StatusDesc || '').trim().toUpperCase();

    if (C.cancelled(r)) return '已取消';
    if (C.overdue(r)) return 'OVERDUE';

    if (
      ['PAID', 'SETTLE', 'SETTLED'].includes(code) ||
      ['PAID', 'SETTLE', 'SETTLED'].includes(desc)
    ) {
      return 'PAID';
    }

    if (
      ['PEND', 'PENDING'].includes(code) ||
      desc === 'PENDING'
    ) {
      return 'PENDING';
    }

    return r.StatusDesc || r.Status || '未提供';
  }

  let successRefreshTimer;
  let successHooksReady = false;
  function beginBookingSave(editor) {
    if (bookingSave || editor.querySelector('[name="strFacilityBookingID"]')?.value) return;
    clearTimeout(successRefreshTimer);
    const controls = Array.from(panel.querySelectorAll('.wyBar button, .wyBar input'));
    const state = {editor, phase:'saving', ready:scheduleReady,
      controls:controls.map(control => [control, control.disabled]), poll:null};
    bookingSave = state;
    scheduleReady = false;
    for (const control of controls) control.disabled = true;
    setScheduleLoading(true, dateInput.value);
    loadingLabel.textContent = '正在儲存預訂…';
    say('正在儲存預訂…');
    // Native validation may stop before any request is sent. An unsuccessful request
    // also has no success event. Once native requests finish, restore the form/grid;
    // only save-success is allowed to advance to settlement or the final refresh.
    state.poll = setInterval(() => {
      if (bookingSave !== state || state.phase !== 'saving') {
        clearInterval(state.poll);
        return;
      }
      if (!getPageWindow().jQuery?.active) {
        scheduleReady = state.ready;
        finishBookingSave(state);
        say('預訂尚未確認儲存，請檢查原表單的驗證或錯誤訊息。', true);
      }
    }, 100);
  }
  function finishBookingSave(state) {
    if (!state || bookingSave !== state) return;
    clearInterval(state.poll);
    bookingSave = null;
    for (const [control, disabled] of state.controls) control.disabled = disabled;
    refreshButton.disabled = busy;
    setScheduleLoading(busy, dateInput.value);
  }
  async function refreshAfterBookingSave() {
    const state = bookingSave;
    if (state) { state.phase = 'refreshing'; clearInterval(state.poll); }
    try {
      // Give the native success handler time to finish closing/searching its form.
      await wyPause(200);
      await load({afterBookingSave:true});
    } finally { finishBookingSave(state); }
  }
  // 1.3.70: choose Settled/Overdue while creating a booking. The booking is created natively as Pending;
  // once saved, the native "Change To" + SAVE step is run for that record, so validation and
  // server-side confirmation behave exactly as when done by hand.
  const wyPause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function readAfterStatus(editor) {
    const raw = editor?.dataset?.wyAfter;
    if (!raw) return null;
    delete editor.dataset.wyAfter;
    try {
      const plan = JSON.parse(raw);
      return plan.status === 'PAID' && C.valid(plan.date) && /^\d{1,2}:\d{2}$/.test(plan.start) ? plan : null;
    } catch { return null; }
  }
  async function findCreatedBooking(plan) {
    const who = identity();
    const dmy = C.dmy(plan.date);
    const query = {
      strFacilityID: null, strBlock: null, strFloor: null, strFlat: null, strStatus: null, strSearch: '',
      strDateFrom: dmy, strDateTo: dmy, strFacilityBookingID: '',
      strEstate: who.estate, strCurrentUser: who.user
    };
    const norm = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const alike = (a, b) => { a = norm(a); b = norm(b); return !a || !b || a === b || a.includes(b) || b.includes(a); };
    for (let attempt = 0; attempt < 8; attempt++) {
      await wyPause(attempt ? 800 : 500);
      const records = await C.collect(
        (start, end) => invoke('GetFacliltyBookingWithSelectedRow',
          {...query, strStartRow:String(start), strEndRow:String(end), strOrder:'Created Date', strIsASC:'0'}),
        () => invoke('GetFacliltyBookingTotalNumber', {...query, strFacilityID:''}),
        () => {}
      );
      // A slot cannot be double booked, so a Pending booking in the same slot is the one just created.
      const matches = records.filter(r =>
        r.FacilityBookingID && paymentState(r) === 'PENDING' && C.day(r.Date) === plan.date &&
        C.minutes(r.TimeFrom) === C.minutes(plan.start) &&
        alike(plan.facility, r.FacilityName) && alike(plan.venue, C.venueName(r)));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw Error('找到多於一筆相同時段的 Pending 預訂，為免誤改，請在原記錄中手動設定狀態。');
    }
    throw Error('找不到剛建立的預訂，請在原記錄中手動設定狀態。');
  }
  async function applyNativeStatus(record, status, label) {
    await waitBooking(() => !busy && !openingBooking, '時間表仍在更新，請稍後在原記錄中手動設定狀態。');
    const jq = getPageWindow().jQuery;
    // The native form still opens and runs (validation, confirmation, server call) but stays invisible.
    // It is shown again only if the native form needs something from the user.
    document.documentElement.classList.add('wyQuietNative');
    try {
      openRecord(record, {quiet:true});
      const opened = await waitBooking(() => {
        const editor = Array.from(document.querySelectorAll('.edit-page-details')).find(e =>
          String(e.querySelector('[name="strFacilityBookingID"]')?.value) === String(record.FacilityBookingID));
        const footer = Array.from(editor?.closest('.clsInputDialog')?.children || []).find(c => c.classList.contains('footer'));
        const confirm = footer?.querySelector('.btn-confirm');
        const select = editor?.querySelector('select[name="strStatus"]');
        if (!confirm || !select || select.disabled || confirm.offsetParent === null) return null;
        return Array.from(select.options).some(o => o.value === status) ? {editor, confirm, select} : null;
      }, '原系統記錄未能打開，請在原記錄中手動設定狀態。');
      jq(opened.select).val(status).trigger('change');
      await wyPause(150);
      const outcome = await new Promise(resolve => {
        let poll, timer;
        const done = result => { clearInterval(poll); clearTimeout(timer); jq(document).off('.wyQuietConfirm'); resolve(result); };
        jq(document).on('submit-action-success.wyQuietConfirm', '.edit-page-details', function(e, action) {
          if (e.target === opened.editor && String(action).toLowerCase() === 'confirm') done('ok');
        });
        poll = setInterval(() => { if (opened.editor.querySelector('.validate-error')) done('invalid'); }, 100);
        timer = setTimeout(() => done('timeout'), 10000);
        opened.confirm.click();
      });
      if (outcome === 'invalid') throw Error('原表單要求補充資料（例如聯絡電話或付款方式）。已預選 ' + label + '，補完後請按 SAVE。');
      if (outcome === 'timeout') throw Error('原系統沒有回應，請在原記錄中確認狀態。');
    } finally { document.documentElement.classList.remove('wyQuietNative'); }
  }
  let settlingAfterCreate = false;
  async function settleAfterCreate(plan) {
    if (settlingAfterCreate) {
      say('上一筆預訂仍在設定狀態，這一筆請在原記錄中手動設定。', true);
      return;
    }
    const label = 'Settled';
    settlingAfterCreate = true;
    if (bookingSave) { bookingSave.phase = 'settling'; clearInterval(bookingSave.poll); }
    setScheduleLoading(true, plan.date);
    loadingLabel.textContent = '正在建立並設為 ' + label + '…';
    let failure = '';
    try {
      say('正在建立並設為 ' + label + '…');
      const record = await findCreatedBooking(plan);
      await applyNativeStatus(record, plan.status, label);
    } catch (e) {
      // A timeout does not prove that the server kept the Pending state.
      failure = e.message + '（預訂本身已建立，請確認實際付款狀態。）';
    } finally {
      // The confirm success event is suppressed below. This owns the single final
      // refresh, and loading stays visible until load() has rendered and painted.
      await refreshAfterBookingSave();
      settlingAfterCreate = false;
    }
    if (failure) { say(failure, true); toast(failure, true); }
    else toast('已建立並設為 ' + label);
  }

  // 1.3.71: the native "Saved" alert is replaced by a short toast; every other message still pops up.
  let toastTimer;
  function toast(text, isError) {
    let box = document.getElementById('wyToast');
    if (!box) { box = el('div', null, 'wyToast'); box.id = 'wyToast'; box.setAttribute('role', 'status'); document.body.append(box); }
    box.textContent = text;
    box.classList.toggle('wyToastError', !!isError);
    box.classList.add('wyToastShow');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('wyToastShow'), isError ? 4500 : 1800);
  }
  let quietSavedReady = false;
  function installQuietSaved() {
    if (quietSavedReady) return;
    const util = getPageWindow().msgBoxUtil;
    if (!util || typeof util.set !== 'function' || typeof util.show !== 'function') return;
    const nativeSet = util.set, nativeShow = util.show;
    let lastMessage = '';
    // Only a "Saved" alert that was just set is skipped; any other message (errors, confirmations) shows as before.
    util.set = function(box, title, message) { lastMessage = String(message ?? '').trim(); return nativeSet.apply(this, arguments); };
    util.show = function() {
      const skip = /^saved$/i.test(lastMessage);
      lastMessage = '';
      if (skip) { if (!settlingAfterCreate && !bookingSave) toast('已儲存'); return; }
      return nativeShow.apply(this, arguments);
    };
    quietSavedReady = true;
  }

  function installBookingSuccessHooks() {
    if (successHooksReady) return;
    const pageWindow = getPageWindow();
    const jq = pageWindow.jQuery;
    if (!jq?.fn?.on) return;
    jq(document).on('save-success.wyDailyRefresh submit-action-success.wyDailyRefresh', '.edit-page-details', function(e, action) {
      // Ignore events bubbling from nested editors, such as additional charges.
      if (e.target !== this) return;
      if (e.type === 'submit-action-success' && !['confirm','cancelbook','savedetail'].includes(String(action).toLowerCase())) return;
      if (settlingAfterCreate) return;
      if (e.type === 'save-success') {
        const plan = readAfterStatus(this);
        if (plan) { settleAfterCreate(plan); return; }
        if (bookingSave?.editor === this) {
          refreshAfterBookingSave().then(() => toast('已儲存'));
          return;
        }
      }
      clearTimeout(successRefreshTimer);
      successRefreshTimer = setTimeout(() => {
        load();
      }, 200);
    });
    successHooksReady = true;
  }

  function createdTime(r) {
    const value=r.CreatedDate ?? r.CreateDate ?? r.CreatedOn ?? r.DateCreated ?? r.Created_Date ?? r['Created Date'];
    if (value == null || value === '') return '未提供';
    const text=String(value).trim();
    if (/^\d{2}-\d{2}-\d{4}(?:$|\s)/.test(text)) return text;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return C.dmy(text);
    const dotnet=/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text);
    const local=/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text);
    const date=new Date(dotnet ? Number(dotnet[1]) : local ? text.replace(' ','T')+'+08:00' : text);
    if (!Number.isFinite(date.getTime())) return text;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Hong_Kong',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
    const get=k=>parts.find(p=>p.type===k).value;
    return get('day')+'-'+get('month')+'-'+get('year')+' '+get('hour')+':'+get('minute')+':'+get('second');
  }
  let gridLocator, hoveredGridCell;
  function hideGridLocator() { gridLocator?.remove(); gridLocator = null; hoveredGridCell?.classList.remove('wyHoveredCell'); hoveredGridCell = null; }
  function installGridLocator() {
    // Overlays never alter table borders, row heights, payment colours or clicks.
    table.addEventListener('mousemove', e => {
      const cell = e.target.closest('td[data-wy-column]');
      if (!cell || !table.contains(cell) || !cell.classList.contains('wyBookable')) { hideGridLocator(); return; }
      // Scroll, resize and table rebuilds already invalidate the current outline.
      if (cell === hoveredGridCell) return;
      const col = cell.getBoundingClientRect();
      const wholeBBQ = ['bbq1', 'bbq2'].includes(cell.dataset.wyColumnId) && cell.rowSpan > 1;
      const band = wholeBBQ ? col : cell.parentElement.getBoundingClientRect();
      const bounds = table.getBoundingClientRect();
      const scroll = table.closest('.wyScroll').getBoundingClientRect();
      const left = Math.max(bounds.left, scroll.left, 0);
      const top = Math.max(bounds.top, scroll.top, 0);
      const right = Math.min(bounds.right, scroll.right, window.innerWidth);
      const bottom = Math.min(bounds.bottom, scroll.bottom, window.innerHeight);
      if (right <= left || bottom <= top) { hideGridLocator(); return; }
      if (!gridLocator) {
        gridLocator = el('div', null, 'wyGridLocator');
        gridLocator.append(el('div', null, 'wyLocatorRow'), el('div', null, 'wyLocatorCell'));
        panel.append(gridLocator);
      }
      Object.assign(gridLocator.style, {left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});
      if (hoveredGridCell !== cell) {
        hoveredGridCell?.classList.remove('wyHoveredCell');
        hoveredGridCell = cell;
        cell.classList.add('wyHoveredCell');
      }
      const [horizontal, outline] = gridLocator.children;
      Object.assign(outline.style, {left:(col.left-left)+'px',top:(col.top-top)+'px',width:col.width+'px',height:col.height+'px'});
      Object.assign(horizontal.style, {left:(bounds.left-left)+'px',top:(band.top-top)+'px',width:Math.max(0, col.right-bounds.left)+'px',height:band.height+'px'});

    });
    table.addEventListener('mouseleave', hideGridLocator);
    table.addEventListener('click', hideGridLocator);
    window.addEventListener('scroll', hideGridLocator, true);
    window.addEventListener('resize', hideGridLocator);
  }
  let hoverDetails, hoverTimer, hoverOwner;
  function hideHoverDetails() {
    clearTimeout(hoverTimer);hoverOwner?.removeAttribute('aria-describedby');hoverOwner=null;hoverDetails?.remove();hoverDetails=null;
  }
  function positionHoverDetails(x,y) {
    if (!hoverDetails) return;
    const rect=hoverDetails.getBoundingClientRect();
    hoverDetails.style.left=Math.max(12,Math.min(x+16,window.innerWidth-rect.width-12))+'px';
    hoverDetails.style.top=Math.max(12,Math.min(y+16,window.innerHeight-rect.height-12))+'px';
  }
  function bookingFee(r) {
    const raw = r.Fee;
    if (raw == null || String(raw).trim() === '') return '未提供';
    const text = String(raw).trim().replace(/,/g, '');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return String(raw);
    const value = Number(text);
    return Number.isFinite(value) ? 'HK$ ' + value.toLocaleString('en-HK', {
      minimumFractionDigits:2, maximumFractionDigits:2
    }) : '未提供';
  }
  function showHoverDetails(r,owner,x,y) {
    hideHoverDetails();hoverOwner=owner;hoverDetails=el('div',null,'wyHoverDetails');
    hoverDetails.id='wyBookingTooltip';hoverDetails.setAttribute('role','tooltip');owner.setAttribute('aria-describedby',hoverDetails.id);
    hoverDetails.append(el('strong',r.RefNo || '預訂詳情'));
    for (const [label,value] of [['設施',r.FacilityName],['場地',r.ItemVenue || r.Venue],['單位',r.BlockFloorFlat || C.unit(r)],['住戶',r.ResidentName || r.ResidentNameSpare],['日期',C.dmy(C.day(r.Date))],['時段',(r.TimeFrom || '')+'–'+(r.TimeTo || '')],['付款狀態',paymentState(r)],['付款金額',bookingFee(r)],['建立時間',createdTime(r)],['Last Update',r.ModifiedBy ?? r.LastUpdate ?? r.LastUpdatedBy ?? originalLastUpdate(r)],['備註',r.Remarks || '—']]) hoverDetails.append(el('p',label+'：'+(value ?? '—')));
    panel.append(hoverDetails);positionHoverDetails(x,y);
  }
  function attachHoverDetails(target,r) {
    target.addEventListener('mouseenter',e=>{hideHoverDetails();hoverTimer=setTimeout(()=>showHoverDetails(r,target,e.clientX,e.clientY),200)});
    target.addEventListener('mousemove',e=>positionHoverDetails(e.clientX,e.clientY));
    target.addEventListener('mouseleave',hideHoverDetails);
    target.addEventListener('focus',()=>{const rect=target.getBoundingClientRect();showHoverDetails(r,target,rect.left,rect.bottom)});
    target.addEventListener('blur',hideHoverDetails);target.addEventListener('click',hideHoverDetails);
  }

  function openRecord(r, options) {
    hideHoverDetails();
    installBookingSuccessHooks();
    if (busy || openingBooking || (bookingSave && !options?.quiet)) return;
    const pageWindow = getPageWindow();
    const jq = pageWindow.jQuery;
    if (!jq?.fn?.editPage || !r.FacilityBookingID) {
      say('原系統記錄功能未就緒或缺少預訂編號，請重新整理。', true);
      return;
    }
    try {
      const who = identity();
      const record = {...r, EstateID:r.EstateID ?? who.estate};
      const item = Array.from(oldTable.querySelectorAll('tbody tr')).find(row =>
        row.getAttribute('data-facliltybooking') === String(r.FacilityBookingID));
      // Reuse the original list event, including its detail load and view-mode setup.
      jq(root).trigger('result-item-double-click', [item ? jq(item) : jq([]), record]);
      if (!options?.quiet) document.querySelector('.edit-page-details')?.scrollIntoView?.({behavior:'smooth',block:'start'});
    } catch (e) { say('無法打開原系統記錄：' + e.message, true); }
  }

  let openingBooking = false;
  async function waitBooking(check, message) {
    const limit = Date.now() + 20000;
    while (Date.now() < limit) {
      const value = check();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(message);
  }
  function chooseBookingOption(options, label) {
    if (options.length === 1) return options[0];
    if (!options.length) throw Error('找不到對應的' + label + '，請在原表單手動選擇。');
    const answer = window.prompt('選擇' + label + '：\n' + options.map((o,i) => (i+1) + '. ' + o.textContent.trim()).join('\n'), '1');
    if (answer === null) throw Error('已停止自動填入，原表單可手動操作。');
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || !options[index]) throw Error('選項無效，請在原表單手動選擇。');
    return options[index];
  }
  async function setBookingDefault(form, jq, fieldName, label, matches) {
    // Match loaded option labels/values, never assume a numeric payment ID.
    const choice = await waitBooking(() => {
      if (!form.isConnected) throw Error('新增預訂表單已關閉。');
      const select = form.querySelector('select[name="' + fieldName + '"]');
      if (!select || select.disabled) return null;
      const options = Array.from(select.options).filter(o =>
        o.value && !o.disabled && !o.parentElement?.disabled && matches(o));
      return options.length === 1 ? {select, option:options[0]} : null;
    }, '未能預設' + label + '，請在原表單手動選擇。');
    jq(choice.select).val(choice.option.value).trigger('change');
    await waitBooking(() => !jq.active, label + '仍在載入，請手動確認。');
  }
  async function openBooking(column, rowIndex) {
    installBookingSuccessHooks();
    if (busy || bookingSave || !scheduleReady || openingBooking || dateInput.value !== shownDate) return;
    const date = shownDate;
    const hour = 8 + rowIndex;
    const sessionHours = ['bbq1','bbq2'].includes(column.id) ? 3 : 1;
    const add = root.querySelector('.btn-book');
    if (!add || add.disabled) { say('找不到原系統新增預訂按鈕。', true); return; }
    const pageWindow = getPageWindow();
    const jq = pageWindow.jQuery;
    if (!jq?.fn?.datepicker) { say('原系統日期功能尚未就緒，請重新整理。', true); return; }
    openingBooking = true;
    try {
      say('正在打開新增預訂表單…');
      add.click();
      const form = await waitBooking(() => document.querySelector('.edit-page-details'), '找不到新增預訂表單。');
      await waitBooking(() => !jq.active, '原系統仍在載入，請手動完成表單。');
      const facility = await waitBooking(() => {
        const select = form.querySelector('select[name="strFacilityID"]');
        return select?.options.length ? select : null;
      }, '設施選項未能載入。');
      const options = Array.from(facility.options).filter(o => o.value && (
        C.classify({FacilityName:o.textContent}) === column.id ||
        (['game1','game2'].includes(column.id) && /game|遊戲/i.test(o.textContent))
      ));
      const selected = chooseBookingOption(options, '設施');
      jq(facility).val(selected.value).trigger('change');
      await waitBooking(() => !jq.active, '場地仍在載入，請手動完成表單。');
      const venue = await waitBooking(() => {
        const select=form.querySelector('select[name="strVenueID"]');
        return select?.options.length ? select : null;
      }, '場地選項未能載入。');
      const venues=Array.from(venue.options).filter(o=>o.value);
      const matching=venues.filter(o => C.classify({FacilityName:selected.textContent,ItemVenue:o.textContent})===column.id);
      if (['game1','game2'].includes(column.id) && !matching.length) throw Error('無法確認遊戲室編號，請在原表單手動選擇場地。');
      const chosenVenue=chooseBookingOption(matching.length ? matching : venues,'場地');
      jq(venue).val(chosenVenue.value).trigger('change');
      await waitBooking(() => !jq.active, '日期仍在載入，請手動完成表單。');
      const calendar=form.querySelector('.facility-date-pick');
      if (!calendar) throw Error('找不到預訂日期欄位。');
      jq(calendar).datepicker('setDate', C.dmy(date));
      const [year,month,day]=date.split('-').map(Number);
      const cell=Array.from(calendar.querySelectorAll('[data-handler="selectDay"]')).find(td =>
        Number(td.dataset.year)===year && Number(td.dataset.month)===month-1 && Number(td.textContent.trim())===day);
      if (!cell || !cell.querySelector('a')) { jq(calendar).datepicker('setDate',''); throw Error('該日期不可預訂，請在原表單選擇可用日期。'); }
      cell.querySelector('a').click();
      await waitBooking(() => !jq.active,'可用時段仍在載入，請手動選擇。');
      const times=form.querySelector('select[name="strTime"]');
      const available=Array.from(times?.options || []).filter(o=>!o.disabled && !o.parentElement.disabled &&
        !['isbooked','isnoservice','isexpried','isconflicted','isotherbooked'].some(k=>['1','true'].includes(String(o.getAttribute(k)).toLowerCase())));
      const slot=available.find(o => {
        const match=/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(o.value) || /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(o.textContent);
        return match && C.minutes(match[1])===hour*60 && C.minutes(match[2])<= (hour+sessionHours)*60;
      });
      if (slot) jq(times).val([slot.value]).trigger('change');
      await waitBooking(() => !jq.active, '預訂資料仍在載入，請手動完成表單。');
      await setBookingDefault(form, jq, 'strSource', 'Source：Walk In', o =>
        /^walk[\s_-]*in$/i.test(o.textContent.trim()) || /^walkin$/i.test(o.value));
      await setBookingDefault(form, jq, 'strPaymentMethodID', 'Payment Method：Octopus', o =>
        /^octopus$/i.test(o.textContent.trim()));
      say(slot ? '已填入日期、設施及可用時段；請在原表單確認住戶與付款資料。' : '已填入日期及設施；該小時沒有可自動選擇的時段，請在原表單確認。');
      form.scrollIntoView?.({behavior:'smooth',block:'start'});
    } catch (e) { say(e.message, true); }
    finally { openingBooking=false; }
  }

  function signature(list) {
    return JSON.stringify(list.map(b => b.key).sort());
  }
function isFixedGrey(rowIndex, columnId) {
  if (columnId === 'game1' || columnId === 'game2') {
    return rowIndex === 0;
  }

  if (columnId === 'tennis') {
    return [0, 1, 13].includes(rowIndex);
  }

  if (columnId === 'bbq1' || columnId === 'bbq2') {
    return [0, 1, 5, 9, 13].includes(rowIndex);
  }

  return false;
}

    let hkHolidays = new Map();
let hkHolidayYears = new Set();
let hkHolidayState = 'idle';

function loadHKHolidays() {
  if (hkHolidayState !== 'idle') return;
  hkHolidayState = 'loading';

  function failed() {
    hkHolidayState = 'failed';
    if (shownDate) updateDateLabel();
  }

  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://www.1823.gov.hk/common/ical/tc.json',
    timeout: 15000,

    onload(response) {
      try {
        if (response.status !== 200) {
          throw Error('假期資料讀取失敗');
        }

        const json = JSON.parse(response.responseText);
        const holidays = new Map();
        const years = new Set();

        const asList = v =>
          Array.isArray(v) ? v : v ? [v] : [];

        function readValue(v) {
          for (let i = 0; i < 5; i++) {
            if (Array.isArray(v)) {
              v = v[0];
            } else if (
              v && typeof v === 'object' && 'value' in v
            ) {
              v = v.value;
            } else {
              break;
            }
          }
          return String(v ?? '');
        }

        for (const calendar of asList(json.vcalendar)) {
          for (const event of asList(calendar.vevent)) {
            const raw = readValue(event.dtstart).replace(/-/g, '');
            const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
            const name = readValue(event.summary).trim();

            if (!match || !name) continue;

            const date =
              `${match[1]}-${match[2]}-${match[3]}`;

            if (!C.valid(date)) continue;

            const list = holidays.get(date) || [];

            if (!list.includes(name)) list.push(name);

            holidays.set(date, list);
            years.add(match[1]);
          }
        }

        if (!holidays.size) {
          throw Error('假期資料格式不符');
        }

        hkHolidays = holidays;
        hkHolidayYears = years;
        hkHolidayState = 'ready';

        if (shownDate) updateDateLabel();
      } catch {
        failed();
      }
    },

    onerror: failed,
    ontimeout: failed,
    onabort: failed
  });
}

  // Each feed owns its request and timer. Failed updates keep the last good data.
  function createWeatherPoller(url, parse, update, interval, retry=interval) {
    let stopped=false, pending=false, timer, request;
    const refresh=()=>{
      if(stopped || pending)return;
      clearTimeout(timer);pending=true;let finished=false;
      const done=result=>{
        if(finished)return;finished=true;pending=false;
        if(stopped)return;
        update(result);
        timer=setTimeout(refresh,result===null?retry:interval);
      };
      try {
        request=GM_xmlhttpRequest({method:'GET',url,timeout:15000,
          onload(response) {
            let result=null;
            try {if(response.status===200)result=parse(JSON.parse(response.responseText));}catch {}
            done(result);
          },onerror(){done(null);},ontimeout(){done(null);}});
      }catch {done(null);}
    };
    return {refresh,stop(){stopped=true;clearTimeout(timer);request?.abort?.();}};
  }

  // HKO fnd API; independent of the booking date and booking requests.
  const FORECAST_URL='https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc';
  let forecastBox, forecastData=null, forecastFailed=false, forecastMountObserver;
  function parseForecast(json) {
    if (!Array.isArray(json?.weatherForecast) || !json.weatherForecast.length) throw Error('九日預報未提供');
    const number=row=>row?.value!==null && row?.value!=='' && Number.isFinite(Number(row?.value))?Number(row.value):null;
    const dates=new Set();
    const days=json.weatherForecast.map(row=>{
      const date=String(row.forecastDate || '');
      const iso=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8);
      if (!/^\d{8}$/.test(date) || !C.valid(iso) || dates.has(date)) throw Error('預報日期無效');
      dates.add(date);
      const icon=Number(row.ForecastIcon);
      return {date,iso,week:String(row.week || ''),icon:Number.isInteger(icon)&&icon>=50&&icon<=93?icon:null,
        low:number(row.forecastMintemp),high:number(row.forecastMaxtemp),rhLow:number(row.forecastMinrh),rhHigh:number(row.forecastMaxrh),
        description:String(row.forecastWeather || ''),wind:String(row.forecastWind || ''),rain:String(row.PSR || '')};
    }).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,9);
    return {days,updated:String(json.updateTime || '')};
  }
  function mountForecast() {
    const head=document.querySelector('div.clsMasterHead');
    if (!head) return false;
    if (!forecastBox) {
      forecastBox=el('section');forecastBox.id='wyNineDayForecast';
      forecastBox.setAttribute('aria-label','香港天文台九天天氣預報');
      forecastBox.setAttribute('aria-live','polite');
    }
    if (forecastBox.parentNode!==head) head.append(forecastBox);
    renderForecast();return true;
  }
  function renderForecast() {
    if (!forecastBox) return;
    const heading=el('div',null,'wyForecastHeading');heading.append(el('span','九天天氣預報'));
    const update=forecastData?.updated.replace('T',' ').replace(/\+08:00$/,'');
    heading.append(el('small',forecastFailed?'更新失敗'+(update?' · 上次資料：'+update:''):update?'香港天文台 · '+update:'香港天文台','wyForecastMeta'));
    if(status) heading.append(status);
    const grid=el('div',null,'wyForecastDays');
    for (const day of forecastData?.days || []) {
      const card=el('div',null,'wyForecastDay');
      card.title=[day.description,day.wind,day.rain?'顯著降雨概率：'+day.rain:''].filter(Boolean).join('\n');
      const weekend=[0,6].includes(new Date(day.iso+'T00:00:00Z').getUTCDay());
      const top=el('div',null,'wyForecastRow wyForecastTop');
      const bottom=el('div',null,'wyForecastRow wyForecastBottom');
      top.append(el('span',day.date.slice(6,8)+'-'+day.date.slice(4,6),'wyForecastDate'+(weekend?' wyForecastWeekend':'')),el('span',day.week));
      if(day.icon!==null) {
        const img=el('img');img.src='https://www.hko.gov.hk/images/HKOWxIconOutline/pic'+day.icon+'.png';
        img.alt=day.description || '天氣圖示';img.width=22;img.height=22;img.onerror=()=>{img.remove();};top.append(img);
      }
      const range=(a,b,unit)=>(a===null?'—':a)+'–'+(b===null?'—':b)+unit;
      bottom.append(el('span',range(day.low,day.high,'°C'),'wyForecastTemp'),el('span','濕度 '+range(day.rhLow,day.rhHigh,'%'),'wyForecastHumidity'));
      card.append(top,bottom);
      grid.append(card);
    }
    forecastBox.replaceChildren(heading,forecastData?grid:el('span',forecastFailed?'暫時無法讀取九日預報，稍後自動重試。':'正在讀取九日預報…','wyForecastMeta'));
  }
  function refreshForecast() { forecastPoller.refresh(); }

  function initForecast() {
    if(!mountForecast()) {
      forecastMountObserver=new MutationObserver(()=>{if(mountForecast()){forecastMountObserver.disconnect();forecastMountObserver=null;}});
      forecastMountObserver.observe(document.body,{childList:true,subtree:true});
    }
    refreshForecast();
  }

  const WEATHER_URL='https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc';
  let weatherData=null, weatherFailed=false;
  const WARNING_URL='https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc';
  const WARNING_ICONS={WHOT:'vhot',WCOLD:'cold',WRAINA:'raina',WRAINR:'rainr',WRAINB:'rainb',
    WTS:'ts',WFNTSA:'ntfl',WL:'landslip',WMSGNL:'sms',WFROST:'frost',WFIRER:'firer',WFIREY:'firey',
    TC1:'tc1',TC3:'tc3',TC8NE:'tc8ne',TC8SE:'tc8b',TC8SW:'tc8c',TC8NW:'tc8d',TC9:'tc9',TC10:'tc10',WTMW:'tsunami-warn'};
  let warningData=[], warningFailed=false;
  function parseWarnings(json, now=Date.now()) {
    if (!json || typeof json!=='object' || Array.isArray(json)) throw Error('警告資料格式錯誤');
    const result=[];
    for (const item of Object.values(json)) {
      if (!item || typeof item!=='object') throw Error('警告資料格式錯誤');
      const code=String(item.code || '').toUpperCase();
      if (code==='CANCEL' || String(item.actionCode).toUpperCase()==='CANCEL') continue;
      const expires=Date.parse(item.expireTime);
      if (Number.isFinite(expires) && expires<=now) continue;
      if (!code) throw Error('警告缺少代號');
      if (result.some(x=>x.code===code)) continue;
      result.push({code,name:[item.type,item.name || code].filter(Boolean).join(' · '),
        expires:Number.isFinite(expires)?expires:null,updated:String(item.updateTime || item.issueTime || '')});
    }
    return result;
  }
  function appendWarnings(badge) {
    const group=el('span',null,'wyWeatherWarnings');
    group.setAttribute('aria-label','香港天文台生效中的天氣警告');
    for (const item of warningData) {
      if (item.expires!==null && item.expires<=Date.now()) continue;
      const entry=el('span',null,'wyWeatherWarning');
      entry.title=item.name+(item.updated?'；更新：'+item.updated:'')+(warningFailed?'；更新失敗，顯示上次資料':'');
      const fallback=el('span',item.name,'wyWeatherWarningFallback');
      const icon=WARNING_ICONS[item.code];
      if (icon) {
        const img=el('img');img.src='https://www.hko.gov.hk/tc/wxinfo/dailywx/images/'+icon+'.gif';
        img.alt=item.name;img.width=32;img.height=32;
        fallback.hidden=true;
        img.onerror=()=>{img.remove();fallback.hidden=false;};entry.append(img);
      }
      entry.append(fallback);group.append(entry);
    }
    if (warningFailed) group.append(el('small','警告更新失敗','wyWeatherLive'));
    if (group.childNodes.length) badge.append(group);
  }
  function refreshWarnings() { warningPoller.refresh(); }

  function parseWeather(json) {
    const station = list => (Array.isArray(list)?list:[]).find(x=>x.place==='香港天文台' || x.place==='Hong Kong Observatory');
    const value = row => row && row.value!==null && row.value!=='' && Number.isFinite(Number(row.value)) ? Number(row.value) : null;
    const temperature=value(station(json.temperature?.data));
    const humidity=value(station(json.humidity?.data));
    const icons=(Array.isArray(json.icon)?json.icon:[]).map(Number).filter(n=>Number.isInteger(n) && n>=50 && n<=93);
    if (temperature===null && humidity===null && !icons.length) throw Error('天氣資料未提供');
    return {temperature,humidity:humidity!==null && humidity>=0 && humidity<=100 ? humidity:null,icons,updated:String(json.updateTime || '')};
  }
  function appendWeather() {
    if (!weatherSlot) return;
    const badge=el('span',null,'wyWeather');
    badge.setAttribute('aria-label','香港天文台即時天氣');
    badge.append(el('small','即時','wyWeatherLive'));
    if (weatherData) {
      const icons=el('span',null,'wyWeatherIcons');
      for(const code of weatherData.icons) {
        const img=el('img');img.src='https://www.hko.gov.hk/images/HKOWxIconOutline/pic'+code+'.png';
        img.alt='天氣圖標 '+code;img.width=26;img.height=26;
        img.onerror=()=>{img.hidden=true;};icons.append(img);
      }
      badge.append(icons);
      const temperature=el('span',weatherData.temperature===null?'— °C':'氣溫:'+weatherData.temperature.toFixed(1)+'°C');
      temperature.title='香港天文台氣溫';
      const humidity=el('span',weatherData.humidity===null?'— %':'濕度:'+weatherData.humidity+'%');humidity.title='香港天文台相對濕度';
      badge.append(temperature,humidity);
      if (weatherFailed) badge.append(el('small','更新失敗','wyWeatherLive'));
      badge.title='資料來源：香港天文台；即時氣溫及相對濕度'+(weatherData.updated?'；更新：'+weatherData.updated:'');
    } else badge.append(el('span',weatherFailed?'天氣暫未能讀取':'正在讀取天氣…'));
    appendWarnings(badge);
    weatherSlot.replaceChildren(badge);
  }
  function refreshWeather() { weatherPoller.refresh(); }

  const forecastPoller=createWeatherPoller(FORECAST_URL,parseForecast,result=>{
    forecastFailed=result===null;if(!forecastFailed)forecastData=result;renderForecast();
  },30*60*1000,60*1000);
  const warningPoller=createWeatherPoller(WARNING_URL,parseWarnings,result=>{
    warningFailed=result===null;if(!warningFailed)warningData=result;appendWeather();
  },60*1000);
  const weatherPoller=createWeatherPoller(WEATHER_URL,parseWeather,result=>{
    weatherFailed=result===null;if(!weatherFailed)weatherData=result;appendWeather();
  },5*60*1000);

function updateDateLabel() {
  if (!shownDate) return;

  const date = new Date(shownDate + 'T00:00:00Z');
  const dayOfWeek = date.getUTCDay();

  const weekdays = [
    '星期日', '星期一', '星期二', '星期三',
    '星期四', '星期五', '星期六'
  ];

  const holidayNames = hkHolidays.get(shownDate) || [];
  const weekend = dayOfWeek === 0 || dayOfWeek === 6;

  let text =
    '日期：' + C.dmy(shownDate) +
    '（' + weekdays[dayOfWeek] + '）';

  if (holidayNames.length) {
    text += '｜' + holidayNames.join('、');
  } else if (hkHolidayState === 'loading') {
    text += '（正在讀取假期資料…）';
  } else if (hkHolidayState === 'failed') {
    text += '（未能取得公眾假期資料）';
  } else if (
    hkHolidayState === 'ready' &&
    !hkHolidayYears.has(shownDate.slice(0, 4))
  ) {
    text += '（假期資料未涵蓋此年份）';
  }

  const dateLabel=el('span',text);
  dateText.replaceChildren(dateLabel);
  dateText.style.color =
    weekend || holidayNames.length ? '#B4412F' : '';
}
  function originalLastUpdate(r) {
    if (!oldTable || !r.RefNo) return '';
    const normalize = value => String(value ?? '').replace(/\s+/g, '').toLowerCase();
    const headers = Array.from(oldTable.querySelectorAll('thead th'));
    if (!headers.length) return '';
    const refIndex = headers.findIndex(h => normalize(h.textContent) === 'refno');
    const updateIndex = headers.findIndex(h => normalize(h.textContent) === 'lastupdate');
    if (refIndex < 0 || updateIndex < 0) return '';
    const ref = normalize(r.RefNo);
    for (const row of oldTable.querySelectorAll('tbody tr')) {
      if (normalize(row.cells[refIndex]?.textContent) === ref) {
        return row.cells[updateIndex]?.textContent || '';
      }
    }
    return '';
  }
  function hasFPS(r) {
    const fromAPI = Object.entries(r).some(([key,value]) => {
      const name = key.toLowerCase().replace(/[^a-z0-9]/g,'');
      const updateField = /(?:lastupdate|lastupdated|lastmodify|lastmodified|updatedby|updateby|modifiedby|modifyby|lastedit|editedby)/.test(name);
      return updateField && value != null && /FPS/i.test(String(value));
    });
    return fromAPI || /FPS/i.test(originalLastUpdate(r));
  }
  function facilityIconLabel(column, r) {
    if (column.id === 'ball') return sportLabel(r);
    const labels = {
      table:'🏓 乒乓球', yoga:'🧘 瑜伽房',
      game1:'🎮 游戲室1', game2:'🎮 游戲室2',
      tennis:'🎾 網球場', musicA:'🎹 琴房', musicB:'🥁 鼓房',
      bbq1:'🍖 燒烤場1', bbq2:'🍖 燒烤場2'
    };
    return labels[column.id] || '📍 ' + column.label;
  }
  function sportLabel(r) {
    const text=[r.FacilityName,r.ItemVenue,r.Venue,r.ActivityName,r.SportName,r.BookingType,r.Activity,r.Sport].filter(Boolean).join(' ');
    const labels=[];
    if (/badminton|羽毛球|\bBM\b/i.test(text)) labels.push('🏸 羽毛球');
    if (/basketball|籃球|篮球|\bBB\b/i.test(text)) labels.push('🏀 籃球');
    return labels.join(' / ') || '球類未指定';
  }
  function blockingDeletePayload(id, who) {
    // Matches the verified native DelNoService request. Identity is always live.
    return {strNoServiceGroupID:String(id),strEstateID:String(who.estate),strCurrentUser:who.user};
  }
  async function releaseBlocking(r) {
    const id=r._wySource?.NoServiceGroupID;
    if (id == null || !/^\d+$/.test(String(id))) throw Error('封鎖記錄缺少有效編號，無法放場。');
    const who=identity();
    const original=r._wySource;
    if (original.EstateID != null && String(original.EstateID)!==String(who.estate)) throw Error('封鎖記錄屋苑不符，已停止。');
    const payload=blockingDeletePayload(id,who);
    const current=identity();
    if (current.estate!==who.estate || current.user!==who.user) throw Error('登入身份已改變，未提交刪除。');
    // Use the same full-list query that successfully loads the timetable.
    // A group-filtered query can return a non-list sentinel after deletion.
    const readGroups = () => queryBlockingGroups(who);
    const before=await readGroups();
    if (!before.some(x=>String(x.NoServiceGroupID)===String(id))) return;
    let submitted=false;
    try {
      submitted=true;
      await invoke('DelNoService',payload,undefined,BLOCKING_API);
      const remaining=await readGroups();
      if (remaining.some(x=>String(x.NoServiceGroupID)===String(id))) throw Error('原系統仍有這筆 Blocking，未能確認放場成功。');
    } catch(e) {
      if (submitted) {
        e.wyDeletionSubmitted=true;
        e.message='刪除請求已提交，但核對未完成：'+e.message+' 請關閉視窗後重新讀取，先核對記錄是否仍存在。';
      }
      throw e;
    }
  }

  function showBlockDetails(r) {
    hideHoverDetails();
    const overlay = el('div', null, 'wyModal');
    const card = el('div', null, 'wyCard');
    card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
    card.setAttribute('aria-label','Out of Service 詳情');
    const previous = document.activeElement;
    let releasing=false;
    const close = () => {if(releasing)return;document.removeEventListener('keydown',keys);overlay.remove();previous?.focus?.();};
    const keys = e => {
      if (e.key === 'Escape') {e.preventDefault();close();}
      if (e.key === 'Tab') {
        const controls=Array.from(card.querySelectorAll('button')).filter(x=>!x.disabled);
        const first=controls[0],last=controls.at(-1);
        if (!first) {e.preventDefault();return;}
        if (e.shiftKey && document.activeElement===first) {e.preventDefault();last.focus();}
        else if (!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus();}
      }
    };
    card.append(el('h3','Out of Service'));
    const original = r._wySource;
    for (const [label,value] of [
      ['Remark',r.Remarks || 'Out of Service'],['設施',r.FacilityName],
      ['場地',r.ItemVenue || r.Venue],['日期',C.dmy(shownDate)],
      ['時段',r.TimeFrom+'–'+r.TimeTo],['Event',original.TitleEng || original.EventName],
      ['日期範圍',original.NoServiceDateFrom+' – '+(original.NoServiceDateTo || original.NoServiceDateFrom)],
      ['重複規則',original.ServiceGCode],['星期（0=日，6=六）',original.Week],
      ['每月日子',original.Day],['編號',original.NoServiceGroupID]
    ]) if (value != null && value !== '') card.append(el('p',label+'：'+value));
    const closeButton = button('關閉',close);
    const result=el('p','');result.setAttribute('role','status');
    let deletionUncertain=false;
    const releaseButton=button('放場',async () => {
      if (releasing) return;
      const id=r._wySource?.NoServiceGroupID;
      releasing=true;releaseButton.disabled=true;closeButton.disabled=true;
      result.textContent='正在放場，請稍候…';
      try {
        await releaseBlocking(r);
        releasing=false;close();
        await load({preserveRange:true});
      } catch(e) {
        deletionUncertain=!!e.wyDeletionSubmitted;
        result.textContent=e.message;
      } finally {releasing=false;releaseButton.disabled=deletionUncertain;closeButton.disabled=false;}
    });
    releaseButton.style.marginLeft='8px';
    releaseButton.disabled=r._wySource?.NoServiceGroupID==null;
    card.append(result,closeButton,releaseButton);overlay.append(card);panel.append(overlay);
    overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    document.addEventListener('keydown',keys);closeButton.focus();
  }

  function inactiveFacilityLabel(r) {
    const column=C.cols.find(c=>c.id===C.classify(r));
    return column ? [column.label,column.labelZh].filter(Boolean).join(' / ') :
      String(r.ItemVenue || r.Venue || r.FacilityName || '未分類設施')+'（待對應）';
  }
  function inactiveStatus(r) {
    const updated=[r.LastUpdate,r['Last Update'],r.LastUpdatedBy,r.ModifiedBy,originalLastUpdate(r)]
      .map(v=>String(v ?? '').trim()).find(Boolean) || '';
    if (/\bAUTO[\s_-]*EXPI\b/i.test(updated)) return '超過48小時未付款已經自動取消';
    if (/\bnwd\\[^\s]+/i.test(updated)) return '職員已手動取消';
    // Do not infer a cancellation reason when the native record has none.
    return C.cancelled(r) ? 'CANCELLED' : 'OVERDUE';
  }
  function renderInactive() {
    inactiveSection.replaceChildren();
    const records=data.filter(r=>C.day(r.Date)===shownDate && (C.overdue(r)||C.cancelled(r)));
    inactiveSection.hidden=!records.length;
    if(!records.length)return;
    inactiveSection.append(el('div','當日 Overdue / Cancelled 記錄（'+records.length+' 筆）','wyInactiveTitle'));
    const listTable=el('table'), head=el('thead'), header=el('tr');
    for(const label of ['Ref No','設施','單位','時間','Status'])header.append(el('th',label));
    head.append(header);listTable.append(head);
    const body=el('tbody');
    records.sort((a,b)=>(C.minutes(a.TimeFrom)??9999)-(C.minutes(b.TimeFrom)??9999)||String(a.RefNo||'').localeCompare(String(b.RefNo||'')));
    for(const r of records) {
      const row=el('tr'),ref=el('td');
      ref.append(button(r.RefNo||String(r.FacilityBookingID),()=>openRecord(r),'wyInactiveRecord'));
      row.append(ref);
      for(const text of [inactiveFacilityLabel(r),C.unit(r),(r.TimeFrom||'')+'–'+(r.TimeTo||''),inactiveStatus(r)])row.append(el('td',text));
      body.append(row);
    }
    listTable.append(body);
    const scroll=el('div',null,'wyScroll');scroll.append(listTable);inactiveSection.append(scroll);
  }
 function render() {
  if (!shownDate) return;
  hideHoverDetails();
  renderInactive();

  const blocked = C.blockRows(noServiceData, shownDate);
  const g = C.grid(data.concat(blocked.rows), shownDate, false, false);
  // BBQ sessions: 10–13, 14–17 and 18–21, separated by fixed grey rows.
  for (let j=0; j<g.columns.length; j++) {
    if (!['bbq1','bbq2'].includes(g.columns[j].id)) continue;
    for (const start of [2,6,10]) {
      const session = new Map();
      for (let row=start; row<start+3; row++) for (const booking of g.matrix[row][j]) session.set(booking.key,booking);
      for (let row=start; row<start+3; row++) g.matrix[row][j] = Array.from(session.values());
    }
  }

  loadHKHolidays();
  updateDateLabel();

  hideGridLocator();
  table.replaceChildren();

    const head = el('thead');
    const hr = el('tr');
    hr.append(el('th', '時間'));

    for (const c of g.columns) {
      const heading = el('th', c.label);
      if (c.labelZh) heading.append(el('span', c.labelZh, 'wyHeaderZh'));
      hr.append(heading);
    }

    head.append(hr);
    table.append(head);

    const body = el('tbody');
    const covered = new Set();

    const clock = n =>
      String(Math.floor(n / 60)).padStart(2, '0') + ':' +
      String(n % 60).padStart(2, '0');

    for (let i = 0; i < 14; i++) {
      const tr = el('tr');
      // Continued reservations still occupy an hour; service blocks alone do
      // not force otherwise empty rows to the 60px reservation height.
      if (g.matrix[i].every(list => list.every(b => b.row._wyOutOfService))) {
        tr.classList.add('wyEmptyRow');
      }

      tr.append(el(
        'td',
        clock(480 + i * 60) + ' – ' + clock(540 + i * 60),
        'wyTime'
      ));

      for (let j = 0; j < g.columns.length; j++) {
        if (covered.has(i + ':' + j)) continue;

        const list = g.matrix[i][j];
        const td = el('td');
        let span = 1;

        const bbqSession = ['bbq1','bbq2'].includes(g.columns[j].id) && [2,6,10].includes(i);
        if (list.length || bbqSession) {
          while (
  i + span < 14 &&
  signature(g.matrix[i + span][j]) === signature(list) &&
  isFixedGrey(i + span, g.columns[j].id) ===
    isFixedGrey(i, g.columns[j].id)
) {
            covered.add((i + span) + ':' + j);
            span++;
          }

          td.rowSpan = span;

          const active = list.filter(b => !b.row._wyOutOfService && !C.cancelled(b.row) && !C.overdue(b.row));

          const hasPending = active.some(b => paymentState(b.row) === 'PENDING');
          const hasPaid = active.some(b => paymentState(b.row) === 'PAID');
          if (hasPending && hasPaid) {
            td.className = 'wyMixedCell';
          } else if (hasPending) {
            td.className = 'wyPendingCell';
          } else if (hasPaid) {
            td.className = 'wySettledCell';
          }
        }

        td.dataset.wyColumnId = g.columns[j].id;
        td.dataset.wyColumn = [g.columns[j].label, g.columns[j].labelZh].filter(Boolean).join(' / ');
        td.dataset.wyTime = clock(480+i*60)+'–'+clock(480+(i+span)*60);
        const hasBlock = list.some(b => b.row._wyOutOfService);
        const cellViewport = hasBlock ? el('div', null, 'wyBlockedContent') : null;
        const cellContent = hasBlock ? el('div', null, 'wyBlockedInner') : list.length ? el('div', null, 'wyReservationContent') : td;
        if (!hasBlock && list.length) td.append(cellContent);
        if (hasBlock) {
          cellViewport.tabIndex = 0;
          cellViewport.setAttribute('role', 'region');
          cellViewport.setAttribute('aria-label', '封鎖時段內容（可捲動）');
          cellViewport.append(cellContent);
          td.append(cellViewport);
        }

        for (const b of list) {
          const r = b.row;
          if (r._wyOutOfService) {
            const block = el('div',null,'wyBlocked');
            block.tabIndex = 0;block.setAttribute('role','button');
            block.setAttribute('aria-label','Out of Service：'+(r.Remarks || '未填寫 Remark')+'；按下查看詳情');
            block.append(el('span',r.Remarks || 'Out of Service','wyBlockRemark'));
            block.append(el('small',r.TimeFrom+'–'+r.TimeTo));
            block.title = 'Out of Service\n'+(r.Remarks || '未填寫 Remark')+'\n'+r.TimeFrom+'–'+r.TimeTo+'\n按下查看完整詳情';
            block.onclick = () => showBlockDetails(r);
            block.onkeydown = e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault();showBlockDetails(r);}};
            cellContent.append(block);continue;
          }

          const cls = 'wyBooking' + (
            C.cancelled(r) ? ' wyCancelled' :
            C.overdue(r) ? ' wyOverdue' :
            paymentState(r) === 'PENDING' ? ' wyPending' :
            paymentState(r) === 'PAID' ? ' wySettled' : ''
          );

          const btn = button(null, () => openRecord(r), cls);
          btn.dataset.wyBookingId = String(r.FacilityBookingID ?? '');
          btn.dataset.wyRefNo = String(r.RefNo ?? '');
          btn.append(el('span', C.unit(r), 'wyBookingUnit'));
          btn.append(el('small', facilityIconLabel(g.columns[j], r), 'wySport'));

          btn.append(
            el('small', (r.TimeFrom || '') + '–' + (r.TimeTo || ''), 'wyBookingTime'),
            el('small', paymentState(r) === 'PAID' && hasFPS(r) ? 'PAID by FPS' : paymentState(r),
              'wyPayment' + (paymentState(r) === 'PAID' && hasFPS(r) ? ' wyFPSPayment' : ''))
          );


          attachHoverDetails(btn, r);
          if (list.length === 1 && !list.some(b=>b.row._wyOutOfService)) attachHoverDetails(td, r);
          cellContent.append(btn);
        }
if (list.some(b=>b.row._wyOutOfService)) {
  td.classList.add('wyBlockedCell');
} else if (isFixedGrey(i, g.columns[j].id)) {
  td.classList.add('wyFixedGrey');
} else if (!list.length) {
  td.classList.add('wyBookable');
  td.title = '雙擊建立預訂';
  td.ondblclick = () => openBooking(g.columns[j], i);
}

        tr.append(td);
      }

      body.append(tr);
    }

    table.append(body);

    const extras = g.columns.filter(
      c => c.id.startsWith('extra:')
    ).length;

    for (const booking of g.accepted.filter(b=>!b.row._wyOutOfService && !C.cancelled(b.row))) {
      if (g.accepted.some(b=>b.row._wyOutOfService && b.col===booking.col && b.start<booking.end && b.end>booking.start)) {
        g.warnings.push({row:booking.row,reason:'預訂與 Out of Service 時段重疊，請核對'});
      }
    }
    warning.replaceChildren();
    warning.hidden = extras === 0 && g.warnings.length === 0;

    if (extras) {
      warning.append(el(
        'div',
        '有 ' + extras +
        ' 個設施／房間未能自動對應，已加入額外欄位；' +
        '請核對設施名稱。'
      ));
    }

    for (const w of g.warnings) {
      warning.append(el(
        'div',
        (w.row.RefNo || w.row.FacilityBookingID || '記錄') +
        '：' + w.reason + '，' +
        (w.row.BlockFloorFlat || '') + ' ' +
        (w.row.TimeFrom || '') + '–' + (w.row.TimeTo || '')
      ));
    }
  }

  function switchMode() {
    mode = !mode;
    root.classList.toggle('wyOriginalHidden', mode);
    hideGridLocator();
    hideHoverDetails();
    oldTable.style.display = mode ? 'none' : originalDisplay;

    for (const e of oldPager) {
      e.style.display = mode ? 'none' : pagerDisplays.get(e);
    }

    panel.querySelector('.wySheetBody').hidden = !mode;
    modeButton.textContent = mode ? '查看原列表' : '查看每日時間表';
  }

  function createScheduleDatePicker() {
    const pageWindow = getPageWindow();
    const jq = pageWindow.jQuery;
    if (!jq?.fn?.datepicker) return dateInput;
    const picker = el('input');
    picker.type = 'text';
    picker.className = 'wyCalendarInput';
    picker.setAttribute('aria-label', '預訂日期（DD-MM-YYYY）');
    picker.placeholder = 'DD-MM-YYYY';
    picker.maxLength = 10;
    picker.autocomplete = 'off';
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const localDate = iso => {
      const [y,m,d] = iso.split('-').map(Number);
      return new Date(y,m-1,d);
    };
    const syncPicker = iso => {
      if (C.valid(iso)) jq(picker).datepicker('setDate', localDate(iso));
      else picker.value = '';
    };
    jq(picker).datepicker({
      dateFormat:'dd-mm-yy', firstDay:0,
      monthNames:['January','February','March','April','May','June','July','August','September','October','November','December'],
      dayNamesMin:['Su','Mo','Tu','We','Th','Fr','Sa'],
      showOtherMonths:false, changeMonth:false, changeYear:false,
      onSelect() {
        const date = jq(picker).datepicker('getDate');
        if (!date) return;
        dateInput.value = jq.datepicker.formatDate('yy-mm-dd',date);
        load();
        // jQuery UI may restore focus after onSelect; blur after it finishes.
        setTimeout(() => {
          if (document.activeElement === picker) picker.blur();
        }, 0);
      },
      beforeShow() { syncPicker(dateInput.value); }
    });
    Object.defineProperty(dateInput, 'value', {
      configurable:true,
      get() { return nativeValue.get.call(this); },
      set(value) { nativeValue.set.call(this,value); syncPicker(nativeValue.get.call(this)); }
    });
    dateInput.type = 'hidden';
    syncPicker(dateInput.value);
    picker.addEventListener('change', () => {
      try {
        const date = jq.datepicker.parseDate('dd-mm-yy', picker.value);
        const iso = jq.datepicker.formatDate('yy-mm-dd',date);
        if (!C.valid(iso)) throw Error('invalid');
        if (iso !== dateInput.value) { dateInput.value=iso; load(); }
      } catch {
        syncPicker(dateInput.value);
        say('請以 DD-MM-YYYY 輸入有效日期。',true);
      }
    });
    picker.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); picker.dispatchEvent(new Event('change')); }
    });
    const wrapper = el('span', null, 'wyCalendarControl');
    wrapper.append(dateInput,picker);
    return wrapper;
  }

  function installBlockingDefaults(editor,jq,win) {
    let stopped=false, timer, pendingVenue=false, facilityValue='', quiet=0;
    const applied=new Set();
    const select = name => editor.querySelector('select[name="'+name+'"]');
    const validOptions = control => Array.from(control?.options || []).filter(o =>
      o.value!=='' && !o.disabled && !o.parentElement?.disabled);
    const choose = (control,option) => {
      if (control && option && control.value!==option.value) jq(control).val(option.value).trigger('change');
    };
    const defaults = () => {
      if (stopped) return;
      for (const [name,value,label] of [['strCode','Main','Maintenance'],['strServiceGCode','D','Date']]) {
        if (applied.has(name)) continue;
        const control=select(name);
        const option=validOptions(control).find(o => o.value===value || o.textContent.trim().toLowerCase()===label.toLowerCase());
        if (option) { applied.add(name); choose(control,option); }
      }
    };
    const settleVenue = () => {
      if (stopped || !pendingVenue) return;
      const facility=select('strFacilityID');
      if (!facility || facility.value!==facilityValue || !facilityValue) { pendingVenue=false; return; }
      const venue=select('strVenueID');
      if (!jq.active && venue && !venue.disabled && validOptions(venue).length) quiet++;
      else quiet=0;
      if (quiet>=2) {
        pendingVenue=false;
        choose(venue,validOptions(venue)[0]);
        return;
      }
      timer=setTimeout(settleVenue,150);
    };
    jq(editor).on('change.wyBlockingDefaults','select[name="strFacilityID"]',function() {
      clearTimeout(timer);facilityValue=this.value;pendingVenue=!!facilityValue;quiet=0;
      if (pendingVenue) timer=setTimeout(settleVenue,150);
    });
    const observer=new win.MutationObserver(defaults);
    observer.observe(editor,{subtree:true,childList:true});
    defaults();
    // The new form must leave Facility for the user, not inherit a cached record.
    const facility=select('strFacilityID');
    if (facility && Array.from(facility.options).some(o=>o.value==='') && facility.value!=='') {
      jq(facility).val('').trigger('change');
    }
    return () => {stopped=true;clearTimeout(timer);observer.disconnect();jq(editor).off('.wyBlockingDefaults');};
  }

  let blockingOverlay = null;
  const blockingPagePath = '/CMS/Club/OutOfService.aspx';
  let blockingPrefetch = null;
  function createBlockingPage() {
    const shade = el('div', null, 'wyBlockingOverlay');
    shade.hidden = true;
    const card = el('div', null, 'wyBlockingCard');
    card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true');
    card.setAttribute('aria-label','OUT OF SERVICE');
    const toolbar = el('div', null, 'wyBlockingBar');
    const message = el('span','正在載入原系統封鎖表單…');
    message.setAttribute('role','status');
    const frame = el('iframe');
    frame.id = 'wyBlockingNativeFrame';
    frame.title = 'OUT OF SERVICE — Create Blocking';
    // A same-origin frame keeps the native page scripts, dropdown data,
    // validation and authenticated SaveNoService flow in their own scope.
    frame.src = blockingPagePath;
    frame.style.visibility='hidden';
    card.append(toolbar,frame); shade.append(card); panel.append(shade);
    return {shade,toolbar,message,frame};
  }
  function prepareBlockingPage() {
    if (blockingPrefetch || blockingOverlay || document.hidden || !scheduleReady || navigator.connection?.saveData) return;
    const source = root.querySelector('.btnOutOfService');
    if (!source || source.disabled || source.hidden || source.classList.contains('hide') || source.style.display === 'none') return;
    // A resource hint warms the browser cache without creating a browsing
    // context or running the native page's scripts while the grid is in use.
    blockingPrefetch = el('link');
    blockingPrefetch.rel = 'prefetch';
    blockingPrefetch.as = 'document';
    blockingPrefetch.fetchPriority = 'low';
    blockingPrefetch.href = blockingPagePath;
    document.head.append(blockingPrefetch);
  }
  function openBlockingForm() {
    if (blockingOverlay) { blockingOverlay.querySelector('button')?.focus(); return; }
    hideHoverDetails(); hideGridLocator();
    const previousFocus = document.activeElement;
    const {shade, toolbar, message, frame} = createBlockingPage();
    blockingOverlay = shade;
    shade.hidden = false;
    let stopped = false, opened = false, clickedAdd = false, timer, deadline;
    let saveConfirmed = false;
    let diagnostic = '尚未取得頁面';
    let observer, frameJQ, frameDocument, watchTimer, settleTimer, nativeEditor, disposeDefaults;
    const close = () => {
      if (stopped) return;
      stopped = true; disposeDefaults?.(); clearTimeout(timer); clearTimeout(watchTimer); clearTimeout(settleTimer); observer?.disconnect();
      if (frameJQ && frameDocument) {
        frameJQ(frameDocument).off('.wyBlockingEmbed');
        if (nativeEditor) frameJQ(nativeEditor).off('.wyBlockingEmbed');
        frameDocument.removeEventListener('keydown',onKey);
      }
      document.removeEventListener('keydown',onKey);
      shade.remove(); blockingOverlay = null;
      previousFocus?.focus?.();
      if (saveConfirmed) load({preserveRange:true});
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    toolbar.append(message,button('關閉',close));
    document.addEventListener('keydown',onKey);
    toolbar.querySelector('button').focus();
    const fail = text => {
      if (stopped) return;
      clearTimeout(timer); message.textContent=text;
      frame.style.visibility='hidden';
    };
    frame.addEventListener('load', () => {
      if (stopped) return;
      if (opened) {
        if (frame.contentDocument !== frameDocument) close();
      } else {
        clearTimeout(timer);
        poll();
      }
    });
    frame.addEventListener('error',()=>fail('未能載入封鎖表單，請關閉後重試。'));
    deadline = Date.now()+30000;
    const poll = () => {
      if (stopped) return;
      try {
        const pageWindow = getPageWindow();
        const win = pageWindow.document.getElementById(frame.id)?.contentWindow || frame.contentWindow;
        const doc = win.document;
        diagnostic = '頁面：'+(win.location.pathname || 'about:blank')+'；載入：'+(doc?.readyState || '未知');
        if (doc?.readyState === 'complete' && win.location.pathname !== '/blank') {
          if (/login|signin/i.test(win.location.pathname) || doc.querySelector('input[type="password"]')) {
            fail('登入可能已過期，請重新登入原系統後再開啟。'); return;
          }
          const jq = win.jQuery;
          const editor = doc.querySelector('.clsInputDialog [data-save*="SaveNoService"]');
          const add = doc.querySelector('.search-page-master [btn-action="add"], .search-page-master .btn-add, .search-page-master .btn-book, .search-page [btn-action="add"], input.btn-add, button.btn-add');
          diagnostic += '；jQuery：'+!!jq+'；editPage：'+!!jq?.fn?.editPage+
            '；新增按鈕：'+!!add+'；按鈕停用：'+!!add?.disabled+
            '；已點＋：'+clickedAdd+'；封鎖表單：'+!!editor;
          if (!clickedAdd && add && !add.disabled && jq?.fn?.editPage) {
            clickedAdd = true;
            message.textContent = '已點擊原系統＋號，正在等待封鎖表單…';
            add.click();
            timer=setTimeout(poll,0);
            return;
          }
          if (clickedAdd && editor && jq?.fn?.editPage) {
            const who = identity();
            const estate = editor.querySelector('[name="strEstate"]')?.value;
            if (estate && String(estate) !== String(who.estate)) {
              fail('封鎖表單的屋苑與目前 Booking 頁面不一致，請重新整理。'); return;
            }
            frameJQ=jq; frameDocument=doc; nativeEditor=editor;
            // The native plugin may stop propagation; listen on the editor itself.
            jq(editor).on('save-success.wyBlockingEmbed submit-action-success.wyBlockingEmbed', function(e,action) {
              if (e.target !== editor) return;
              if (e.type === 'submit-action-success' && !['save','savedetail','confirm'].includes(String(action).toLowerCase())) return;
              saveConfirmed = true;
              // Let the native success handlers finish before removing the frame.
              clearTimeout(settleTimer); settleTimer=setTimeout(close,100);
            });
            const dialog = editor.closest('.clsInputDialog');
            // Preserve every native node and handler. Hide surrounding page
            // content without removing the page or changing its event scope.
            const css = doc.createElement('style');
            css.textContent = "#processPanel,.clsProcessBox,.clsLoadingBox,.clsOpacityBackgroundWithLoading{display:none!important;visibility:hidden!important;pointer-events:none!important}\nhtml,body{margin:0!important;padding:0!important;background:#F3F5F2!important;overflow:hidden!important}\nbody{visibility:hidden!important}\n.pop-panel,.pop-panel *,.clsInputDialog,.clsInputDialog *{visibility:visible!important}\n.clsInputDialog{position:fixed!important;inset:0!important;margin:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;overflow:auto!important;box-sizing:border-box!important;padding:18px 24px 0!important;background:#fff!important;border:0!important;border-radius:0!important;box-shadow:none!important;color:#1E2B2A;font:14px 'Avenir Next','Segoe UI','PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif}\n.clsInputDialog *{box-sizing:border-box}\n.clsInputDialog>.btn-close,.clsInputDialog .title-bar{display:none!important}\n.clsInputDialog .edit-page-details,.clsInputDialog .clsGridTable{width:100%!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important}\n.clsInputDialog .record-items{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px 22px;padding:0!important;margin:0!important}\n.clsInputDialog .record-items>.field{float:none!important;clear:none!important;width:100%!important;min-width:0;margin:0!important;padding:0!important}\n.clsInputDialog .field>.field-label{display:block;float:none!important;width:100%!important;margin:0 0 7px!important;padding:0!important;font-size:12px;font-weight:bold;color:#44524F;line-height:18px}\n.clsInputDialog .field>.field-input{float:none!important;width:100%!important;margin:0!important;padding:0!important}\n.clsInputDialog select,.clsInputDialog input[type=text],.clsInputDialog input:not([type]),.clsInputDialog textarea{width:100%!important;max-width:100%!important;border:1px solid #C3CCC8!important;border-radius:3px!important;padding:8px!important;background:#fff;color:#1E2B2A;font:14px 'Avenir Next','Segoe UI','PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif}\n.clsInputDialog select:not([multiple]){height:36px!important}\n.clsInputDialog select[multiple]{height:210px!important;line-height:1.6}\n.clsInputDialog select[multiple] option{padding:4px 7px}\n.clsInputDialog .field.remarks,.clsInputDialog .field.week,.clsInputDialog .field.month{grid-column:1 / -1}\n.clsInputDialog .field.remarks textarea{min-height:80px;height:80px;resize:vertical}\n.clsInputDialog .field.last-field{display:none!important}\n.clsInputDialog .ui-datepicker-inline{width:100%!important;max-width:340px;font-size:14px}\n.clsInputDialog .ui-datepicker table{font-size:13px}\n.clsInputDialog .footer.buttons{position:sticky!important;bottom:0;display:flex;justify-content:flex-end;gap:10px;width:100%!important;margin:18px 0 0!important;padding:12px 0!important;background:#fff;border-top:1px solid #DDE3DF;z-index:10}\n.clsInputDialog .footer.buttons button{float:none!important;min-width:92px;padding:9px 20px!important;border:0;border-radius:3px;font:14px 'Avenir Next','Segoe UI','PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif;cursor:pointer}\n.clsInputDialog .footer.buttons .btn-save{background:#234B43;color:white}\n.clsInputDialog .footer.buttons .btn-cancel{background:#E7EEEA;color:#1E2B2A}\n.clsInputDialog .week .checkboxlist{display:inline-flex;gap:5px;align-items:center;margin:4px 12px 4px 0}\n@media(max-width:620px){.clsInputDialog{padding:14px 14px 0!important}.clsInputDialog .record-items{grid-template-columns:minmax(0,1fr);gap:14px}.clsInputDialog .ui-datepicker-inline{max-width:none}}\n";
            doc.head.append(css);
            opened = true; frame.style.visibility='visible';
            message.textContent='OUT OF SERVICE';
            doc.addEventListener('keydown',onKey);
            const visible = () => {
              if (!dialog.isConnected || !editor.isConnected) return false;
              // The popup plugin can hide a wrapper rather than clsInputDialog.
              for (let node=editor; node && node.nodeType===1; node=node.parentElement) {
                if (node.hidden || win.getComputedStyle(node).display==='none') return false;
              }
              return true;
            };
            let wasVisible = visible();
            let hiddenSince = 0;
            const checkClosed = () => {
              if (stopped) return;
              const showing=visible();
              if (showing) { wasVisible=true; hiddenSince=0; }
              else if (wasVisible) {
                if (!hiddenSince) hiddenSince=Date.now();
                if (Date.now()-hiddenSince >= 150) { close(); return; }
              }
            };
            // Observe wrapper changes/removal as well as the form itself.
            observer = new win.MutationObserver(checkClosed);
            observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
            const watch = () => {
              if (stopped) return;
              checkClosed();
              if (!stopped) watchTimer=setTimeout(watch,200);
            };
            watchTimer=setTimeout(watch,200);
            disposeDefaults=installBlockingDefaults(editor,jq,win);
            editor.querySelector('select[name="strFacilityID"]')?.focus();
            return;
          }
        }
      } catch (e) {
        fail('無法載入封鎖表單：'+e.message+'；診斷：'+diagnostic); return;
      }
      if (Date.now() >= deadline) { fail('封鎖表單載入逾時。請複製以下診斷文字：'+diagnostic); return; }
      timer=setTimeout(poll,150);
    };
    poll();
  }

  function addOriginalActionButtons(bar) {
    const group = el('div', null, 'wyOriginalActions');
    const bindings = [];
    for (const [selector,label] of [
      ['.btnOutOfService','OUT OF SERVICE'],
      ['.btnReport','REPORT']
    ]) {
      const source = root.querySelector(selector);
      if (!source) continue;
      const proxy = button(source.value || label, e => {
        e.preventDefault(); e.stopPropagation();
        if (selector === '.btnOutOfService') { openBlockingForm(); return; }
        source.click();
      }, 'wyOriginalAction');
      if (selector === '.btnOutOfService') {
        proxy.addEventListener('pointerenter',prepareBlockingPage);
        proxy.addEventListener('focus',prepareBlockingPage);
      }
      group.append(proxy);
      bindings.push({source,proxy,label});
    }
    const sync = () => {
      for (const {source,proxy,label} of bindings) {
        proxy.textContent = source.value || label;
        proxy.disabled = source.disabled;
        // The search panel itself is hidden in schedule mode. Only inspect
        // the source button's own visibility, not its hidden ancestor.
        proxy.hidden = source.hidden || source.classList.contains('hide') || source.style.display === 'none';
      }
    };
    sync();
    new MutationObserver(sync).observe(root, {
      subtree:true,attributes:true,attributeFilter:['class','style','hidden','disabled','value']
    });
    bar.append(group);
  }

  function installMenuDefaults() {
    const menu=document.getElementById('menuLeft');
    if(!menu)return;
    const applied=new WeakSet();
    const apply=()=>{
      for(const label of menu.querySelectorAll('a.menuLeft_0')) {
        if(!['resident zone','setting'].includes(label.textContent.trim().toLowerCase()))continue;
        const row=label.closest('tr');
        const toggle=Array.from(row?.querySelectorAll('a')||[]).find(a=>a.id && a.querySelector('img') && /TreeView_ToggleNode/.test(a.getAttribute('href')||''));
        const nodes=toggle && document.getElementById(toggle.id+'Nodes');
        if(!nodes || applied.has(nodes))continue;
        applied.add(nodes);
        if(nodes.style.display!=='none' && !nodes.hidden)toggle.click();
      }
    };
    apply();
    const observer=new MutationObserver(apply);
    observer.observe(menu.closest('.clsMenuBar')||menu,{childList:true,subtree:true});
    window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  }

  function init() {
    root = document.querySelector('.search-page-master');
    if (!root) return false;

    oldTable =
      root.querySelector('#tblResult') ||
      root.querySelector('table.tablesorter');

    if (!oldTable) return false;
    if (document.getElementById('wyDailySheet')) return true;

    panel = el('section', null);
    panel.id = 'wyDailySheet';

    const bar = el('div', null, 'wyBar');

    dateInput = el('input');
    dateInput.type = 'date';
    dateInput.setAttribute('aria-label', '預訂日期');
    dateInput.value = C.day(new Date().toISOString());
    const dateControl = createScheduleDatePicker();

    const move = delta => {
      const d = new Date(dateInput.value + 'T12:00:00+08:00');
      if (!Number.isFinite(d.getTime())) return;

      d.setUTCDate(d.getUTCDate() + delta);
      dateInput.value = C.day(d.toISOString());
      load();
    };

    bar.append(
      button('‹ 前一天', () => move(-1)),
      dateControl,
      button('後一天 ›', () => move(1)),
      button('今天', () => {
        dateInput.value = C.day(new Date().toISOString());
        load();
      })
    );

    refreshButton = button('重新讀取', load, 'wyPrimary');

    modeButton = button('查看原列表', switchMode);

    bar.append(
      refreshButton,
      modeButton
    );

    addOriginalActionButtons(bar);
    weatherSlot=el('div',null,'wyWeatherSlot');
    weatherSlot.setAttribute('aria-live','polite');
    bar.append(weatherSlot);
    appendWeather();

    status = el('div', '正在準備每日時間表…', 'wyStatus');
    status.setAttribute('role', 'status');

    dateText = el('div', '', 'wyDate');
    warning = el('div', null, 'wyWarning');
    warning.hidden = true;

    const scroll = el('div', null, 'wyScroll');
    table = el('table');
    installGridLocator();
    scroll.append(table);

    const sheetBody = el('div', null, 'wySheetBody');
    inactiveSection = el('div', null, 'wyInactive');
    inactiveSection.hidden=true;
    loadingOverlay = el('div', null, 'wyScheduleLoading');
    loadingOverlay.hidden = true;
    loadingOverlay.setAttribute('role', 'status');
    loadingOverlay.setAttribute('aria-live', 'polite');
    const loadingCard = el('div', null, 'wyLoadingCard');
    const loadingSpinner = el('span', null, 'wyLoadingSpinner');
    loadingSpinner.setAttribute('aria-hidden', 'true');
    loadingLabel = el('span', '正在更新時間表…');
    loadingCard.append(loadingSpinner, loadingLabel);
    loadingOverlay.append(loadingCard);
    sheetBody.append(dateText, warning, scroll, inactiveSection, loadingOverlay);
    panel.append(bar, status, sheetBody);

    // Keep the toolbar above both views, outside the native sorter's table scope.
    root.parentNode.classList.add('wyScheduleHost');
    root.parentNode.insertBefore(panel, root);
    root.classList.add('wyOriginalHidden');

    originalDisplay = oldTable.style.display;
    oldTable.style.display = 'none';

    oldPager = Array.from(root.querySelectorAll(
      '.pager,.clsGridFooter,.pagedisplay1,.page-input,.pagesize'
    ));

    for (const e of oldPager) {
      pagerDisplays.set(e, e.style.display);
      e.style.display = 'none';
    }

    window.addEventListener('scroll', hideHoverDetails, true);
    window.addEventListener('resize', hideHoverDetails);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideHoverDetails(); });
    installMenuDefaults();
    installDateSync();
    dateInput.onchange = load;
    installBookingSuccessHooks();
    { let tries = 0; const timer = setInterval(() => { installQuietSaved(); if (quietSavedReady || ++tries > 40) clearInterval(timer); }, 500); installQuietSaved(); }
    refreshWeather();
    refreshWarnings();
    initForecast();
    window.addEventListener('pagehide',()=>{
      blockingPrefetch?.remove();
      blockingPrefetch = null;
      for(const poller of [forecastPoller,warningPoller,weatherPoller])poller.stop();
      forecastMountObserver?.disconnect();
    });
    installBookingSuccessHooks();
    // The original list may finish loading after the schedule API request.
    let originalRenderTimer;
    new MutationObserver(() => {
      clearTimeout(originalRenderTimer);
      originalRenderTimer = setTimeout(() => { if (shownDate) render(); }, 100);
    }).observe(oldTable, {childList:true, subtree:true, characterData:true});


    load({preserveRange:true}).then(() => {
      if (window.requestIdleCallback) window.requestIdleCallback(prepareBlockingPage);
      else setTimeout(prepareBlockingPage,500);
    });
    return true;
  }

  if (!init()) {
    const observer = new MutationObserver(() => {
      if (init()) observer.disconnect();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

})((function reservationCore() {
  const cols = [
    { id: 'table', label: 'Table Tennis', labelZh: '乒乓球🏓' },
    { id: 'yoga', label: 'Yoga Room', labelZh: '瑜伽房🧘' },
    { id: 'game1', label: 'Game Room 1', labelZh: '游戲室1🎮' },
    { id: 'game2', label: 'Game Room 2', labelZh: '游戲室2🀄' },
    { id: 'ball', label: 'Ball Court', labelZh: '多用途球場🏸🏀' },
    { id: 'tennis', label: 'Tennis Court', labelZh: '網球場🎾' },
    { id: 'musicA', label: 'Music Room A', labelZh: '琴房🎹' },
    { id: 'musicB', label: 'Music Room B', labelZh: '鼓房🥁' },
    { id: 'bbq1', label: 'BBQ1', labelZh: '燒烤場1🍖' },
    { id: 'bbq2', label: 'BBQ2', labelZh: '燒烤場2🍖' }
  ];

  function valid(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;

    const [y, m, d] = s.split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, d));

    return y >= 1000 &&
      x.getUTCFullYear() === y &&
      x.getUTCMonth() === m - 1 &&
      x.getUTCDate() === d;
  }

  function day(v) {
    if (v == null || v === '') return '';

    const t = String(v);
    const a = /^(\d{2})-(\d{2})-(\d{4})(?:$| )/.exec(t);

    if (a) {
      const date = `${a[3]}-${a[2]}-${a[1]}`;
      return valid(date) ? date : '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      return valid(t) ? t : '';
    }

    const n = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(t);
    const iso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(t)
      ? t.replace(' ', 'T') + '+08:00' : t;
    const d = n ? new Date(Number(n[1])) : new Date(iso);

    if (!Number.isFinite(d.getTime())) return '';

    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);

    const get = k => p.find(x => x.type === k).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function dmy(v) {
    return v.split('-').reverse().join('-');
  }

  function minutes(v) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
      String(v || '').trim()
    );

    if (!m) return null;

    const h = Number(m[1]);
    const n = Number(m[2]);

    const seconds = Number(m[3] || 0);
    return h <= 24 && n < 60 && seconds < 60 && (h < 24 || (n === 0 && seconds === 0))
      ? h * 60 + n
      : null;
  }

  function cancelled(r) {
    const status=String(r.Status ?? '').trim().toUpperCase();
    const desc=String(r.StatusDesc ?? '').trim().toUpperCase();
    const flag=String(r.IsCancelled ?? '').trim().toLowerCase();
    return ['CAN','CANCEL','CANCELLED','CANCELED'].includes(status) ||
      ['CAN','CANCEL','CANCELLED','CANCELED','已取消'].includes(desc) || flag==='true' || flag==='1';
  }

  function overdue(r) {
    const code=String(r.Status ?? '').trim().toUpperCase();
    const desc=String(r.StatusDesc ?? '').trim().toUpperCase();
    return ['EXPI','EXPIRED','EXPIRE','OVERDUE'].includes(code) ||
      ['EXPI','EXPIRED','EXPIRE','OVERDUE','已過期','逾期'].includes(desc);
  }

  // OutOfService.aspx binds its Venue cell to {VenueName}; Booking uses ItemVenue.
  // Treat whitespace-only values as absent so another supplied label can be used.
  function venueName(r) {
    return [r.ItemVenue, r.VenueName, r.Venue, r.VenueEng]
      .map(value => String(value ?? '').trim()).find(Boolean) || '';
  }

  function key(r) {
    return `${r.FacilityID ?? ''}:${r.VenueID ?? ''}:${
      r.VenueID == null
        ? (venueName(r) || String(r.FacilityName || ''))
        : ''
    }`;
  }

  function classify(r) {

    const f = String(r.FacilityName || '')
      .toLowerCase().replace(/[\s_-]+/g, '');

    const v = venueName(r)
      .toLowerCase().replace(/[\s_-]+/g, '');

    const s = f + ' ' + v;

    if (/bbq|barbecue|燒烤|烧烤/.test(s)) {
      if (
        /(?:bbq|barbecue|燒烤|烧烤)(?:area|pit|區|区)?1(?!\d)/.test(s) ||
        /^(?:area|pit|venue)?1$/.test(v)
      ) {
        return 'bbq1';
      }

      if (
        /(?:bbq|barbecue|燒烤|烧烤)(?:area|pit|區|区)?2(?!\d)/.test(s) ||
        /^(?:area|pit|venue)?2$/.test(v)
      ) {
        return 'bbq2';
      }
    }

    if (/tabletennis|乒乓/.test(s)) return 'table';
    if (/yoga|瑜伽/.test(s)) return 'yoga';

    if (/game|遊戲/.test(s)) {
      if (/gameroom1|遊戲室1/.test(s) || /^(?:room)?1$/.test(v)) {
        return 'game1';
      }
      if (/gameroom2|遊戲室2/.test(s) || /^(?:room)?2$/.test(v)) {
        return 'game2';
      }
    }

    if (/music|音樂/.test(s)) {
      if (/musicrooma|音樂室a/.test(s) || /^(?:room)?a$/.test(v)) {
        return 'musicA';
      }
      if (/musicroomb|音樂室b/.test(s) || /^(?:room)?b$/.test(v)) {
        return 'musicB';
      }
    }

    if (/ballcourt|basketball|badminton|籃球|羽毛球/.test(s)) {
      return 'ball';
    }

    if (/tennis|網球/.test(s)) return 'tennis';

    return 'extra:' + key(r);
  }

  function unit(r) {
    const s = String(r.BlockFloorFlat || '');
    const block = /\bBlock\s+([A-Z0-9]+)\b/i.exec(s);
    const blockUnit = /\bUnit\s+([A-Z0-9]+)\b/i.exec(s);
    if (block && blockUnit) return block[1].toUpperCase() + blockUnit[1].toUpperCase();
    const t = /\bTower\s*(\d+)/i.exec(s);
    const f = /\b(\d+|LG\d*|UG\d*|G|B\d*|M)\s*\/?\s*F\b/i.exec(s);
    const u = /\b(?:Flat|Unit)\s*([A-Z0-9]+)/i.exec(s);

    if (t && f && (u || r.FlatName)) {
      return `T${t[1]}-${f[1].toUpperCase()}${String(u ? u[1] : r.FlatName).trim().toUpperCase()}`;
    }

    return s ||
      [r.BlockName, r.FloorName, r.FlatName]
        .filter(x => x != null && x !== '').join(' / ') ||
      r.RefNo ||
      '未提供單位';
  }

  function unwrap(v) {
    for (let i = 0; i < 5; i++) {
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v);
          continue;
        } catch {
          return v;
        }
      }

      if (v && typeof v === 'object' && Object.hasOwn(v, 'd')) {
        v = v.d;
        continue;
      }

      return v;
    }
    return v;
  }

  function rows(v, source = 'Booking / GetFacliltyBookingWithSelectedRow') {
    v = unwrap(v);

    if (Array.isArray(v)) return v;

    if (Array.isArray(v?.tables?.[0]?.rows)) {
      return v.tables[0].rows;
    }

    throw Error(source + '：API 未傳回可讀取的資料列表。');
  }

  function blockRuleReady(r) {
    const code = String(r.ServiceGCode ?? '').trim().toUpperCase();
    return ['D','DR','W','M'].includes(code) &&
      (code !== 'W' || String(r.Week ?? '').trim() !== '') &&
      (code !== 'M' || String(r.Day ?? '').trim() !== '');
  }

  function blockRows(records, date) {
    const result = [], errors = [], seen = new Set();
    const weekday = new Date(date+'T00:00:00Z').getUTCDay();
    const monthday = Number(date.slice(8));
    const clock = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    const integers = (value,min,max) => {
      const parts = String(value ?? '').trim().split(',').map(x=>x.trim());
      if (!parts.length || parts.some(x=>!/^\d+$/.test(x) || Number(x)<min || Number(x)>max)) return null;
      return parts.map(Number);
    };
    for (const r of records) {
      const id = String(r.NoServiceGroupID ?? '未知編號');
      const fail = reason => errors.push('封鎖記錄 '+id+'：'+reason);
      const first = day(r.NoServiceDateFrom), last = r.NoServiceDateTo == null || r.NoServiceDateTo === '' ? first : day(r.NoServiceDateTo);
      if (!valid(first) || !valid(last) || last < first) {fail('日期無效');continue;}
      if (date < first || date > last) continue;
      if (!blockRuleReady(r)) {fail('重複規則未提供或不支援');continue;}
      const code = String(r.ServiceGCode).trim().toUpperCase();
      if (code === 'D' && date !== first) continue;
      if (code === 'W') {
        const days = integers(r.Week,0,6);
        if (!days) {fail('星期規則無效');continue;}
        if (!days.includes(weekday)) continue;
      }
      if (code === 'M') {
        const days = integers(r.Day,1,31);
        if (!days) {fail('每月日子規則無效');continue;}
        if (!days.includes(monthday)) continue;
      }
      const start = minutes(r.NoServiceTimeFrom), end = minutes(r.NoServiceTimeTo);
      if (start == null || end == null) {fail('時段無效');continue;}
      if (end <= start) {fail('結束時間必須晚於開始時間');continue;}
      const base = {
        ...r, Date:date, TimeFrom:clock(start), TimeTo:clock(end),
        ItemVenue:venueName(r),
        FacilityName:r.FacilityName || r.NameEng || '',
        Remarks:String(r.Remarks ?? r.Remark ?? '').trim(),
        Status:'', StatusDesc:'', IsCancelled:false,
        _wyOutOfService:true, _wySource:r
      };
      let columns = [classify(base)];
      // A group without a particular venue closes every room of that facility.
      if (!base.ItemVenue && r.VenueID != null && String(r.VenueID) !== '' && String(r.VenueID) !== '0') {
        fail('場地名稱未提供，無法確認封鎖的是哪個房間');continue;
      }
      if (!base.ItemVenue && /game|遊戲/i.test(base.FacilityName)) columns=['game1','game2'];
      if (!base.ItemVenue && /^\s*(?:music\s*room|音樂室)\s*$/i.test(base.FacilityName)) columns=['musicA','musicB'];
      if (!base.ItemVenue && /^\s*(?:bbq|barbecue(?:\s*area)?|燒烤場)\s*$/i.test(base.FacilityName)) columns=['bbq1','bbq2'];
      for (const col of columns) {
        const token = JSON.stringify([id,r.FacilityID,r.VenueID,col,date,start,end,base.Remarks]);
        if (seen.has(token)) continue;
        seen.add(token);
        result.push({...base,_wyColumn:col,FacilityBookingID:'outofservice:'+token});
      }
    }
    return {rows:result,errors};
  }

  function grid(data, date, includeCancelled = false, includeOverdue = false) {
    const columns = cols.map(c => ({ ...c }));
    const accepted = [];
    const warnings = [];

    for (const r of data) {
      if (day(r.Date) !== date) {
        warnings.push({ row: r, reason: '日期不符' });
        continue;
      }

      if (!includeCancelled && cancelled(r)) continue;
      if (!includeOverdue && overdue(r)) continue;

      const start = minutes(r.TimeFrom);
      const end = minutes(r.TimeTo);

      if (start == null || end == null || end <= start) {
        warnings.push({ row: r, reason: '時段無效' });
        continue;
      }

      const col = r._wyColumn || classify(r);

      if (!columns.some(c => c.id === col)) {
        columns.push({
          id: col,
          label: String(
            r.ItemVenue || r.Venue || r.FacilityName || '未分類設施'
          ) + '（待對應）'
        });
      }

      accepted.push({
        row: r,
        start,
        end,
        col,
        key: String(r.FacilityBookingID ?? r.RefNo ?? accepted.length)
      });

      if (start < 480 || end > 1320) {
        warnings.push({
          row: r,
          reason: '部分或全部時段在 08:00–22:00 之外'
        });
      }
    }

    const matrix = Array.from({ length: 14 }, (_, i) =>
      columns.map(c =>
        accepted.filter(b =>
          b.col === c.id &&
          b.start < 480 + (i + 1) * 60 &&
          b.end > 480 + i * 60
        )
      )
    );

    return { columns, accepted, warnings, matrix };
  }

  async function collect(getPage, getCount, progress = () => {}) {
    let expected = null;

    try {
      const n = unwrap(await getCount());

      if (
        n !== null &&
        n !== '' &&
        typeof n !== 'object' &&
        typeof n !== 'boolean' &&
        Number.isSafeInteger(Number(n)) &&
        Number(n) >= 0
      ) {
        expected = Number(n);
      }
    } catch {}

    const result = [];
    const seen = new Set();
    let start = 1;

    for (let page = 0; page < 200; page++) {
      if (expected !== null && result.length === expected) {
        return result;
      }

      const chunk = rows(await getPage(start, start + 99));

      if (!chunk.length) {
        if (expected !== null && result.length !== expected) {
          throw Error('讀取筆數與總數不一致，請重新整理。');
        }
        return result;
      }

      for (const r of chunk) {
        const id = r.FacilityBookingID ?? r.RefNo;

        if (id == null) {
          throw Error('記錄缺少預訂 ID。');
        }

        if (seen.has(String(id))) {
          throw Error('讀取期間資料有變動或分頁重複，請重試。');
        }

        seen.add(String(id));
        result.push(r);
      }

      if (expected !== null && result.length > expected) {
        throw Error('讀取期間總數有變動，請重試。');
      }

      start += chunk.length;
      progress(result.length, expected);
    }

    throw Error('讀取頁數超出上限，未顯示不完整時間表。');
  }

  return {
    venueName, blockRuleReady, blockRows, cols, valid, day, dmy, minutes, cancelled, overdue, key,
    classify, unit, unwrap, rows, grid, collect
  };
})());
