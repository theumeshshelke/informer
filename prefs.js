// Informer - settings window (opens when you click the bar item)
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {CATEGORIES, PRIORITY_NAMES, THOUGHTS} from './data.js';
import {DAYS_ALL, parseReminders, serializeReminders} from './reminders.js';

function spinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int(key),
        }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

const COLOR_KEYS = ['color-greeting', 'color-good', 'color-bad', 'color-warn', 'color-info', 'color-thought', 'color-focus'];

function rgbaToHex(c) {
    const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
}

function colorRow(settings, key, title, subtitle = '') {
    const row = new Adw.ActionRow({title, subtitle});
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: false}),
        valign: Gtk.Align.CENTER,
    });

    const load = () => {
        const rgba = new Gdk.RGBA();
        if (!rgba.parse(settings.get_string(key)))
            rgba.parse('#ffffff');
        button.set_rgba(rgba);
    };
    load();

    button.connect('notify::rgba', () => {
        const hex = rgbaToHex(button.get_rgba());
        if (hex !== settings.get_string(key))
            settings.set_string(key, hex);
    });
    settings.connect(`changed::${key}`, load);   // follows "Reset colors"

    row.add_suffix(button);
    row.set_activatable_widget(button);
    return row;
}

// One row per kind of message: [priority dropdown] [on/off switch]
function categoryRow(settings, c) {
    const row = new Adw.ActionRow({title: c.title, subtitle: c.sub});
    const key = `priority-${c.key}`;

    const dd = new Gtk.DropDown({
        model: new Gtk.StringList({strings: PRIORITY_NAMES}),
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Priority',
    });
    dd.selected = settings.get_int(key);
    dd.connect('notify::selected', () => {
        if (dd.selected !== settings.get_int(key))
            settings.set_int(key, dd.selected);
    });
    settings.connect(`changed::${key}`, () => {   // follows "Reset priorities"
        const v = settings.get_int(key);
        if (dd.selected !== v)
            dd.selected = v;
    });
    row.add_suffix(dd);

    // small switch: show the icon for this kind of message
    const iconSw = new Gtk.Switch({valign: Gtk.Align.CENTER, tooltip_text: 'Show icon'});
    settings.bind(`icon-${c.key}`, iconSw, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(new Gtk.Label({label: 'Icon', css_classes: ['dim-label'], valign: Gtk.Align.CENTER}));
    row.add_suffix(iconSw);

    if (c.toggle) {
        const sw = new Gtk.Switch({valign: Gtk.Align.CENTER, tooltip_text: 'Show this message'});
        settings.bind(`show-${c.key}`, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(sw);
        row.set_activatable_widget(sw);
    }
    return row;
}

const DAY_LETTERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PRESETS = [
    {label: 'Drink water', time: '11:00', days: DAYS_ALL, repeat: true},
    {label: 'Stretch', time: '15:00', days: 31, repeat: true},
    {label: 'Fixed time event', time: '18:00', days: DAYS_ALL, repeat: true},
];

function daysText(mask) {
    if (mask === DAYS_ALL)
        return 'every day';
    if (mask === 0)
        return 'no days';
    return DAY_LETTERS.filter((_d, i) => mask & (1 << i)).join(', ');
}

// the Reminders page: a list kept in memory, written back as JSON on every change
function buildRemindersPage(settings, window) {
    const page = new Adw.PreferencesPage({title: 'Reminders', icon_name: 'alarm-symbolic'});
    const addGroup = new Adw.PreferencesGroup({
        title: 'Reminders',
        description: 'A message shows at the time you set, using the local clock. ' +
            'A reminder that does not repeat switches itself off after it shows.',
    });
    page.add(addGroup);
    const listGroup = new Adw.PreferencesGroup();
    page.add(listGroup);

    let list = parseReminders(settings.get_string('reminders'));
    let rows = [];
    const save = () => settings.set_string('reminders', serializeReminders(list));
    const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

    const rebuild = () => {
        for (const r of rows)
            listGroup.remove(r);
        rows = [];
        for (const r of list) {
            const row = new Adw.ExpanderRow({title: r.label, subtitle: `${r.time}, ${daysText(r.days)}`});
            const refresh = () => {
                row.title = r.label;
                row.subtitle = `${r.time}, ${daysText(r.days)}${r.repeat ? '' : ', once'}${r.enabled ? '' : ' (off)'}`;
            };
            refresh();

            const on = new Adw.SwitchRow({title: 'On', active: r.enabled});
            on.connect('notify::active', () => { r.enabled = on.active; save(); refresh(); });
            row.add_row(on);

            const label = new Adw.EntryRow({title: 'Text', text: r.label, show_apply_button: true});
            label.connect('apply', () => {
                const t = label.text.replace(/\s+/g, ' ').trim().slice(0, 40);
                if (t) {
                    r.label = t;
                    save();
                    refresh();
                }
            });
            row.add_row(label);

            const [h, m] = r.time.split(':').map(Number);
            const hour = new Adw.SpinRow({title: 'Hour', adjustment: new Gtk.Adjustment({lower: 0, upper: 23, step_increment: 1, value: h})});
            const min = new Adw.SpinRow({title: 'Minute', adjustment: new Gtk.Adjustment({lower: 0, upper: 59, step_increment: 1, page_increment: 5, value: m})});
            const setTime = () => {
                r.time = `${`${Math.round(hour.value)}`.padStart(2, '0')}:${`${Math.round(min.value)}`.padStart(2, '0')}`;
                save();
                refresh();
            };
            hour.connect('notify::value', setTime);
            min.connect('notify::value', setTime);
            row.add_row(hour);
            row.add_row(min);

            const days = new Adw.ActionRow({title: 'Days'});
            const box = new Gtk.Box({spacing: 2, valign: Gtk.Align.CENTER, css_classes: ['linked']});
            DAY_LETTERS.forEach((d, i) => {
                const b = new Gtk.ToggleButton({label: d.slice(0, 2), active: !!(r.days & (1 << i)), tooltip_text: d});
                b.connect('toggled', () => {
                    r.days = b.active ? r.days | (1 << i) : r.days & ~(1 << i);
                    save();
                    refresh();
                });
                box.append(b);
            });
            days.add_suffix(box);
            row.add_row(days);

            const rep = new Adw.SwitchRow({title: 'Repeat', subtitle: 'Off = show once, then switch off', active: r.repeat});
            rep.connect('notify::active', () => { r.repeat = rep.active; save(); refresh(); });
            row.add_row(rep);

            const del = new Adw.ActionRow({title: 'Delete this reminder'});
            const delBtn = new Gtk.Button({label: 'Delete', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
            delBtn.connect('clicked', () => {
                list = list.filter(x => x !== r);
                save();
                rebuild();
            });
            del.add_suffix(delBtn);
            row.add_row(del);

            listGroup.add(row);
            rows.push(row);
        }
    };

    const add = preset => {
        list.push({id: newId(), enabled: true, ...preset});
        save();
        rebuild();
    };

    const addRow = new Adw.ActionRow({title: 'Add a reminder', subtitle: 'Pick one to start from, then edit it'});
    for (const p of PRESETS) {
        const b = new Gtk.Button({label: p.label.replace(' event', ''), valign: Gtk.Align.CENTER});
        b.connect('clicked', () => add(p));
        addRow.add_suffix(b);
    }
    const blank = new Gtk.Button({label: 'Blank', valign: Gtk.Align.CENTER});
    blank.connect('clicked', () => add({label: 'Reminder', time: '09:00', days: DAYS_ALL, repeat: true}));
    addRow.add_suffix(blank);
    addGroup.add(addRow);

    rebuild();
    return page;
}

export default class InformerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 780);

        // ================================================= General
        const general = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(general);

        const basics = new Adw.PreferencesGroup({title: 'General'});
        general.add(basics);

        const idleRow = new Adw.ComboRow({
            title: 'Default line',
            subtitle: 'What the bar shows when there is no message',
            model: new Gtk.StringList({strings: ['Network speed', 'Greeting']}),
        });
        idleRow.selected = settings.get_string('idle-display') === 'greeting' ? 1 : 0;
        idleRow.connect('notify::selected', () => {
            settings.set_string('idle-display', idleRow.selected === 1 ? 'greeting' : 'speed');
        });
        basics.add(idleRow);

        const clickRow = new Adw.ComboRow({
            title: 'Left click',
            subtitle: 'Right click always opens settings. Middle click shows the next good thought.',
            model: new Gtk.StringList({strings: ['Details menu', 'Settings']}),
        });
        clickRow.selected = settings.get_string('left-click') === 'settings' ? 1 : 0;
        clickRow.connect('notify::selected', () => {
            settings.set_string('left-click', clickRow.selected === 1 ? 'settings' : 'menu');
        });
        basics.add(clickRow);

        basics.add(switchRow(settings, 'show-icons', 'Show icons',
            'Arrows for network speed, a sun for the weather, and icons on messages'));

        basics.add(switchRow(settings, 'idle-show-temp', 'Show temperature next to the speed',
            'Needs the weather (Weather page)'));

        basics.add(switchRow(settings, 'speed-colors', 'Colour the speed',
            'Green when fast, amber when slow, red when there is no link'));
        basics.add(spinRow(settings, 'speed-fast-kbps', 'Fast above (KB/s)', '', 64, 1000000));
        basics.add(spinRow(settings, 'speed-slow-kbps', 'Slow below (KB/s)', '', 0, 100000));
        basics.add(spinRow(settings, 'data-usage-hours', 'Data used today: show every (hours)',
            'Shows how much you downloaded and uploaded today', 1, 24));

        const nameRow = new Adw.EntryRow({title: 'Your name (used when the default line is the greeting)'});
        settings.bind('name', nameRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        basics.add(nameRow);

        basics.add(spinRow(settings, 'flash-seconds', 'Message time',
            'Seconds a status message stays in the bar', 2, 30));

        const DIRS = ['right-to-left', 'left-to-right', 'top-to-bottom', 'bottom-to-top', 'flip', 'random'];
        const dirRow = new Adw.ComboRow({
            title: 'Animation',
            subtitle: 'How new text arrives in the bar',
            model: new Gtk.StringList({strings: ['Slide right to left', 'Slide left to right',
                'Roll top to bottom', 'Roll bottom to top', 'Flip', 'Random']}),
        });
        dirRow.selected = Math.max(0, DIRS.indexOf(settings.get_string('direction')));
        dirRow.connect('notify::selected', () => {
            settings.set_string('direction', DIRS[dirRow.selected]);
        });
        basics.add(dirRow);

        const quiet = new Adw.PreferencesGroup({
            title: 'Quiet hours',
            description: 'During quiet hours, and while an app is fullscreen, only Critical messages show.',
        });
        general.add(quiet);
        quiet.add(switchRow(settings, 'quiet-enabled', 'Quiet hours'));
        quiet.add(spinRow(settings, 'quiet-start', 'From', 'Hour of the day (0 to 23)', 0, 23));
        quiet.add(spinRow(settings, 'quiet-end', 'Until', 'Hour of the day (0 to 23)', 0, 23));
        quiet.add(switchRow(settings, 'quiet-fullscreen', 'Stay quiet while fullscreen',
            'Videos, games, presentations'));

        // ---- focus timer
        const focus = new Adw.PreferencesGroup({
            title: 'Focus timer',
            description: 'Start and pause it from the bar menu or with the shortcut. ' +
                'While it runs, the bar shows the countdown instead of the speed.',
        });
        general.add(focus);
        focus.add(spinRow(settings, 'pomodoro-focus-min', 'Focus (minutes)', '', 1, 120));
        focus.add(spinRow(settings, 'pomodoro-short-min', 'Short break (minutes)', '', 1, 60));
        focus.add(spinRow(settings, 'pomodoro-long-min', 'Long break (minutes)', 'Every 4th break', 1, 120));
        focus.add(switchRow(settings, 'pomodoro-sound', 'Play a sound when a phase ends'));
        const keyRow = new Adw.EntryRow({title: 'Shortcut (for example <Super><Alt>p)', show_apply_button: true});
        keyRow.text = settings.get_strv('pomodoro-toggle')[0] ?? '';
        keyRow.connect('apply', () => {
            const t = keyRow.text.trim();
            if (!t) {
                settings.set_strv('pomodoro-toggle', []);
                return;
            }
            const [ok] = Gtk.accelerator_parse(t);
            if (ok)
                settings.set_strv('pomodoro-toggle', [t]);
            else
                keyRow.text = settings.get_strv('pomodoro-toggle')[0] ?? '';   // not a valid shortcut
        });
        focus.add(keyRow);

        // ---- network checks
        const net = new Adw.PreferencesGroup({
            title: 'Network checks',
            description: 'Latency is measured by connecting to 1.1.1.1 (Cloudflare). ' +
                'The public IP and VPN location use ipwho.is.',
        });
        general.add(net);
        net.add(switchRow(settings, 'idle-show-ping', 'Show the latency next to the speed'));
        net.add(spinRow(settings, 'ping-seconds', 'Check latency every (seconds)', '', 5, 300));
        net.add(spinRow(settings, 'ping-warn-ms', 'Warn above (ms)', 'Turn the warning off in Messages', 50, 5000));
        net.add(switchRow(settings, 'public-ip-at-start', 'Look up the public IP at login',
            'Otherwise it is looked up only when a VPN connects or the menu is open'));

        // ================================================= Weather
        const weatherPage = new Adw.PreferencesPage({
            title: 'Weather',
            icon_name: 'weather-few-clouds-symbolic',
        });
        window.add(weatherPage);

        const wx = new Adw.PreferencesGroup({
            title: 'Weather',
            description: 'Data from Open-Meteo (free, no account). Leave the city empty to use ' +
                'the place your IP address points to (looked up through ipwho.is).',
        });
        weatherPage.add(wx);
        wx.add(switchRow(settings, 'weather-enabled', 'Show the weather',
            'Temperature in the bar and a weather message now and then'));

        const cityRow = new Adw.EntryRow({title: 'City (empty = automatic)'});
        settings.bind('weather-city', cityRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        wx.add(cityRow);

        const unitRow = new Adw.ComboRow({
            title: 'Temperature unit',
            model: new Gtk.StringList({strings: ['Celsius (\u00b0C)', 'Fahrenheit (\u00b0F)']}),
        });
        unitRow.selected = settings.get_string('weather-unit') === 'f' ? 1 : 0;
        unitRow.connect('notify::selected', () => {
            settings.set_string('weather-unit', unitRow.selected === 1 ? 'f' : 'c');
        });
        wx.add(unitRow);

        wx.add(spinRow(settings, 'weather-minutes', 'Update every (minutes)',
            'How often the weather is refreshed and shown as a message', 5, 120));

        const wxAlert = new Adw.PreferencesGroup({
            title: 'Weather alerts',
            description: 'A warning shows once when rain, heat or cold starts. Limits are in Celsius.',
        });
        weatherPage.add(wxAlert);
        wxAlert.add(spinRow(settings, 'weather-rain-percent', 'Rain chance (%)',
            'Warn when rain is this likely within 2 hours', 10, 100));
        wxAlert.add(spinRow(settings, 'weather-hot', 'Hot at (\u00b0C)', '', 20, 60));
        wxAlert.add(spinRow(settings, 'weather-cold', 'Cold at (\u00b0C)', '', -40, 20));

        // ================================================= Messages + priority
        const messages = new Adw.PreferencesPage({
            title: 'Messages',
            icon_name: 'view-list-symbolic',
        });
        window.add(messages);

        const kinds = new Adw.PreferencesGroup({
            title: 'What to show, and how important it is',
            description: 'Left: priority. Right: on or off.\n' +
                'When several messages arrive together, the highest priority goes first. ' +
                'A higher priority interrupts the message on screen; the others wait their turn. ' +
                'Critical also ignores quiet hours.',
        });
        messages.add(kinds);
        for (const c of CATEGORIES)
            kinds.add(categoryRow(settings, c));

        const resetPrio = new Adw.ActionRow({title: 'Reset priorities to default'});
        const resetPrioBtn = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        resetPrioBtn.connect('clicked', () =>
            CATEGORIES.forEach(c => settings.reset(`priority-${c.key}`)));
        resetPrio.add_suffix(resetPrioBtn);
        resetPrio.set_activatable_widget(resetPrioBtn);
        kinds.add(resetPrio);

        // notification mirror: which apps
        const notif = new Adw.PreferencesGroup({
            title: 'Notification mirror',
            description: 'Turn it on in the list above. Only the app name and title are shown, never the text.',
        });
        messages.add(notif);
        const appsRow = new Adw.EntryRow({title: 'Only these apps (comma separated, empty = all)', show_apply_button: true});
        appsRow.text = settings.get_strv('notification-apps').join(', ');
        appsRow.connect('apply', () => {
            settings.set_strv('notification-apps',
                appsRow.text.split(',').map(x => x.trim()).filter(x => x));
        });
        notif.add(appsRow);

        // ================================================= Reminders
        window.add(buildRemindersPage(settings, window));

        // ================================================= Alerts
        const alerts = new Adw.PreferencesPage({
            title: 'Alerts',
            icon_name: 'dialog-warning-symbolic',
        });
        window.add(alerts);

        const battery = new Adw.PreferencesGroup({title: 'Battery'});
        alerts.add(battery);
        battery.add(spinRow(settings, 'charge-limit', 'Unplug reminder at (%)',
            'Remind me to unplug while charging above this level. 100 turns it off.', 50, 100));

        const system = new Adw.PreferencesGroup({
            title: 'System warnings',
            description: 'A warning shows after the level stays high for a few seconds, ' +
                'then at most once every 10 minutes.',
        });
        alerts.add(system);
        system.add(spinRow(settings, 'cpu-threshold', 'High CPU use (%)', '', 50, 100));
        system.add(spinRow(settings, 'ram-threshold', 'High RAM use (%)', '', 50, 99));
        system.add(spinRow(settings, 'temp-threshold', 'High temperature (\u00b0C)',
            'Becomes Critical 10\u00b0C above this', 50, 110));
        system.add(spinRow(settings, 'disk-free-percent', 'Low disk space (% free)', '', 2, 50));

        const cal = new Adw.PreferencesGroup({
            title: 'Calendar',
            description: 'Uses the calendars already set up in GNOME (the clock menu).',
        });
        alerts.add(cal);
        cal.add(spinRow(settings, 'calendar-lead', 'Warn me before an event (minutes)', '', 1, 60));

        // ================================================= Thoughts
        const thoughtsPage = new Adw.PreferencesPage({
            title: 'Thoughts',
            icon_name: 'emote-love-symbolic',
        });
        window.add(thoughtsPage);

        const thoughts = new Adw.PreferencesGroup({
            title: 'Good thoughts',
            description: 'Middle-click the bar item to see the next one right away.',
        });
        thoughtsPage.add(thoughts);
        thoughts.add(switchRow(settings, 'thoughts-enabled', 'Show good thoughts'));
        thoughts.add(spinRow(settings, 'thought-minutes', 'Every',
            'Minutes between thoughts', 1, 60));
        thoughts.add(spinRow(settings, 'thought-seconds', 'Thought time',
            'Seconds a thought stays in the bar', 3, 30));

        const own = new Adw.PreferencesGroup({
            title: 'Your own thoughts',
            description: 'One thought per line.',
        });
        thoughtsPage.add(own);
        own.add(switchRow(settings, 'use-builtin-thoughts', 'Also use the built-in thoughts',
            'Yours and the built-in ones take turns. Switch off to use only yours.'));

        const buffer = new Gtk.TextBuffer();
        buffer.set_text(settings.get_strv('thoughts').join('\n'), -1);
        const view = new Gtk.TextView({
            buffer,
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 10,
            right_margin: 10,
        });
        const scroller = new Gtk.ScrolledWindow({
            child: view,
            min_content_height: 240,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });
        scroller.add_css_class('card');
        own.add(scroller);

        // save a moment after typing stops (and when the window closes)
        const save = () => {
            const [start, end] = buffer.get_bounds();
            const lines = buffer.get_text(start, end, false)
                .split('\n').map(l => l.trim()).filter(Boolean);
            settings.set_strv('thoughts', lines);
        };
        let saveTimer = 0;
        buffer.connect('changed', () => {
            if (saveTimer)
                GLib.source_remove(saveTimer);
            saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                saveTimer = 0;
                save();
                return GLib.SOURCE_REMOVE;
            });
        });
        window.connect('close-request', () => {
            if (saveTimer) {
                GLib.source_remove(saveTimer);
                saveTimer = 0;
                save();
            }
            return false;
        });

        const copyRow = new Adw.ActionRow({
            title: 'Start from the built-in list',
            subtitle: 'Copies all built-in thoughts into the box so you can edit or delete any. ' +
                'This replaces what is in the box and turns the built-in list off.',
        });
        const copyBtn = new Gtk.Button({label: 'Copy', valign: Gtk.Align.CENTER});
        copyBtn.connect('clicked', () => {
            buffer.set_text(THOUGHTS.join('\n'), -1);
            settings.set_boolean('use-builtin-thoughts', false);
        });
        copyRow.add_suffix(copyBtn);
        copyRow.set_activatable_widget(copyBtn);
        own.add(copyRow);

        // ================================================= Colors
        const colorsPage = new Adw.PreferencesPage({
            title: 'Colors',
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(colorsPage);

        const colors = new Adw.PreferencesGroup({
            title: 'Colors',
            description: 'Pick the text color for each kind of message.',
        });
        colorsPage.add(colors);
        colors.add(colorRow(settings, 'color-greeting', 'Default line',
            'Network speed (or the greeting)'));
        colors.add(colorRow(settings, 'color-good', 'Good news',
            'Connected, ON, charging, battery full, volume up'));
        colors.add(colorRow(settings, 'color-bad', 'Bad news',
            'Disconnected, OFF, discharging, critical battery, muted, volume down'));
        colors.add(colorRow(settings, 'color-warn', 'Warnings',
            'Unplug reminder, low battery, Caps Lock, high CPU, calendar'));
        colors.add(colorRow(settings, 'color-info', 'Neutral',
            'Hourly line, now playing, updates and other plain messages'));
        colors.add(colorRow(settings, 'color-thought', 'Good thoughts'));
        colors.add(colorRow(settings, 'color-focus', 'Focus timer'));

        const resetRow = new Adw.ActionRow({title: 'Reset colors to default'});
        const resetBtn = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        resetBtn.connect('clicked', () => COLOR_KEYS.forEach(k => settings.reset(k)));
        resetRow.add_suffix(resetBtn);
        resetRow.set_activatable_widget(resetBtn);
        colors.add(resetRow);
    }
}
