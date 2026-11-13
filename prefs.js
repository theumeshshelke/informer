// Informer - settings window (opens when you click the bar item)
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {CATEGORIES, PRIORITY_NAMES, THOUGHTS} from './data.js';

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

const COLOR_KEYS = ['color-greeting', 'color-good', 'color-bad', 'color-warn', 'color-info', 'color-thought'];

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

    if (c.toggle) {
        const sw = new Gtk.Switch({valign: Gtk.Align.CENTER, tooltip_text: 'Show this message'});
        settings.bind(`show-${c.key}`, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(sw);
        row.set_activatable_widget(sw);
    }
    return row;
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

        const nameRow = new Adw.EntryRow({title: 'Your name (shown in the greeting)'});
        settings.bind('name', nameRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        basics.add(nameRow);

        basics.add(spinRow(settings, 'flash-seconds', 'Message time',
            'Seconds a status message stays in the bar', 2, 30));

        const dirRow = new Adw.ComboRow({
            title: 'Slide direction',
            model: new Gtk.StringList({strings: ['Right to left', 'Left to right']}),
        });
        dirRow.selected = settings.get_string('direction') === 'left-to-right' ? 1 : 0;
        dirRow.connect('notify::selected', () => {
            settings.set_string('direction',
                dirRow.selected === 1 ? 'left-to-right' : 'right-to-left');
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
        colors.add(colorRow(settings, 'color-greeting', 'Greeting',
            'Good Morning, Umesh'));
        colors.add(colorRow(settings, 'color-good', 'Good news',
            'Connected, ON, charging, battery full, volume up'));
        colors.add(colorRow(settings, 'color-bad', 'Bad news',
            'Disconnected, OFF, discharging, critical battery, muted, volume down'));
        colors.add(colorRow(settings, 'color-warn', 'Warnings',
            'Unplug reminder, low battery, Caps Lock, high CPU, calendar'));
        colors.add(colorRow(settings, 'color-info', 'Neutral',
            'Hourly line, now playing, updates and other plain messages'));
        colors.add(colorRow(settings, 'color-thought', 'Good thoughts'));

        const resetRow = new Adw.ActionRow({title: 'Reset colors to default'});
        const resetBtn = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        resetBtn.connect('clicked', () => COLOR_KEYS.forEach(k => settings.reset(k)));
        resetRow.add_suffix(resetBtn);
        resetRow.set_activatable_widget(resetBtn);
        colors.add(resetRow);
    }
}
