// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import ModalDialog from './ModalDialog.vue';

afterEach(() => {
  document.body.replaceChildren();
});

describe('ModalDialog', () => {
  it('opens modally, focuses the requested control, and restores focus', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.append(trigger);
    trigger.focus();

    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: { labelledBy: 'test-dialog-title' },
      slots: {
        default:
          '<h2 id="test-dialog-title">Test dialog</h2><button autofocus>Cancel</button>',
      },
    });

    await nextTick();
    await nextTick();

    const dialog = document.body.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="test-dialog-title"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(document.activeElement?.textContent).toBe('Cancel');

    dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(wrapper.emitted('cancel')).toHaveLength(1);

    wrapper.unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it('ignores native dismissal while a destructive action is pending', async () => {
    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: {
        labelledBy: 'locked-dialog-title',
        dismissible: false,
      },
      slots: {
        default: '<h2 id="locked-dialog-title">Working</h2>',
      },
    });
    await nextTick();

    document.body
      .querySelector<HTMLDialogElement>(
        'dialog[aria-labelledby="locked-dialog-title"]',
      )
      ?.dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(wrapper.emitted('cancel')).toBeUndefined();
    wrapper.unmount();
  });
});
