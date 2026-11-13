// Informer - settings window (opens when you click the bar item)
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

const COLOR_KEYS = ['color-greeting', 'color-good', 'color-bad', 'color-info', 'color-thought'];

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

export default class InformerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(560, 760);

        const page = new Adw.PreferencesPage({
            title: 'Informer',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        // ---- General
        const general = new Adw.PreferencesGroup({title: 'General'});
        page.add(general);

        const nameRow = new Adw.EntryRow({title: 'Your name (shown in the greeting)'});
        settings.bind('name', nameRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        general.add(nameRow);

        general.add(spinRow(settings, 'flash-seconds', 'Message time',
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
        general.add(dirRow);

        // ---- Good thoughts
        const thoughts = new Adw.PreferencesGroup({title: 'Good thoughts'});
        page.add(thoughts);
        thoughts.add(switchRow(settings, 'thoughts-enabled', 'Show good thoughts'));
        thoughts.add(spinRow(settings, 'thought-minutes', 'Every',
            'Minutes between thoughts', 1, 60));
        thoughts.add(spinRow(settings, 'thought-seconds', 'Thought time',
            'Seconds a thought stays in the bar', 3, 30));

        // ---- Colors
        const colors = new Adw.PreferencesGroup({
            title: 'Colors',
            description: 'Pick the text color for each kind of message.',
        });
        page.add(colors);
        colors.add(colorRow(settings, 'color-greeting', 'Greeting',
            'Good Morning, Umesh'));
        colors.add(colorRow(settings, 'color-good', 'Good news',
            'Connected, ON, charging, battery full, volume up'));
        colors.add(colorRow(settings, 'color-bad', 'Bad news',
            'Disconnected, OFF, discharging, low battery, muted, volume down'));
        colors.add(colorRow(settings, 'color-info', 'Neutral',
            'Hourly line and other plain messages'));
        colors.add(colorRow(settings, 'color-thought', 'Good thoughts'));

        const resetRow = new Adw.ActionRow({title: 'Reset colors to default'});
        const resetBtn = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        resetBtn.connect('clicked', () => COLOR_KEYS.forEach(k => settings.reset(k)));
        resetRow.add_suffix(resetBtn);
        resetRow.set_activatable_widget(resetBtn);
        colors.add(resetRow);

        // ---- Which messages to show
        const msgs = new Adw.PreferencesGroup({
            title: 'Show messages for',
            description: 'Green = good news, red = something went off.',
        });
        page.add(msgs);
        msgs.add(switchRow(settings, 'show-bluetooth', 'Bluetooth'));
        msgs.add(switchRow(settings, 'show-wifi', 'Wi-Fi'));
        msgs.add(switchRow(settings, 'show-battery', 'Charging / battery'));
        msgs.add(switchRow(settings, 'show-volume', 'Volume'));
        msgs.add(switchRow(settings, 'show-hourly', 'New line every hour'));
    }
}
