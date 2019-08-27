/**
 * Copyright (C) 2015-2019 Mailvelope GmbH
 * Licensed under the GNU Affero General Public License version 3
 */

// import mvelo from '../lib/lib-mvelo';
// import * as l10n from '../lib/l10n';
import {getHash, mapError} from '../lib/util';
// import {DISPLAY_INLINE} from '../lib/constants';
// import {prefs} from '../modules/prefs';
// import {getKeyringWithPrivKey} from '../modules/keyring';
// import * as model from '../modules/pgpModel';
import * as gmail from '../modules/gmail';
import {buildMailWithHeader} from '../modules/mime';

// import * as uiLog from '../modules/uiLog';
// import {isCached} from '../modules/pwdCache';
import * as sub from './sub.controller';
// import {triggerSync} from './sync.controller';
import {getPreferredKeyringId} from '../modules/keyring';

export default class GmailController extends sub.SubController {
  constructor(port) {
    super(port);
    if (!port) {
      this.mainType = 'gmailInt';
      this.id = getHash();
    }
    this.editorControl = null;
    this.editorContentModified = false;
    this.keyringId = getPreferredKeyringId();
    // register event handlers
    this.on('gmail-unauthorize', this.unauthorize);
    this.on('open-editor', this.onOpenEditor);
    this.on('set-encrypted-attachments', this.setEncAttachments);
  }

  unauthorize() {
    gmail.unauthorize();
  }

  /**
   * Opens a new editor control and gets the recipients to encrypt plaintext
   * input to their public keys.
   * @param  {String} options.text   The plaintext input to encrypt
   */
  async onOpenEditor(options) {
    if (this.editorControl) {
      this.editorControl.activateComponent();
      return;
    }
    this.editorControl = sub.factory.get('editor');
    try {
      const {armored, encFiles, subject, recipients} = await this.editorControl.encrypt({
        integration: options.integration,
        predefinedText: options.text,
        quotedMail: options.quotedMail,
        quotedMailIndent: !this.editorContentModified,
        getRecipients: options.getRecipients,
        userEmail: options.userEmail
      });
      // send email via gapi
      const userEmail = options.userEmail;
      const to = recipients.map(r => r.email);
      const quota = gmail.MAIL_QUOTA;
      const message = buildMailWithHeader({message: armored, attachments: encFiles, subject, sender: userEmail, to, quota});
      if (message === null) {
        throw new Error('MIME building failed.');
      }
      console.log(message);
      const accessToken = await gmail.getAccessToken(userEmail, gmail.GMAIL_SCOPE_SEND);
      if (!accessToken) {
        this.editorControl.openAuthorizeDialog(gmail.GMAIL_SCOPE_SEND);
      } else {
        const result = await gmail.sendMessage({email: userEmail, message, accessToken});
        console.log(result);
        this.editorContentModified = true;
        this.editorControl = null;
      }
    } catch (err) {
      if (err.code == 'EDITOR_DIALOG_CANCEL') {
        this.editorControl = null;
        // this.emit('mail-editor-close');
        return;
      }
      this.editorControl.ports.editor.emit('error-message', {error: mapError(err)});
    }
  }

  setEncAttachments({controllerId, userEmail, msgId, encAttFileNames}) {
    const normalizedControllerId = controllerId.split('-')[1];
    const decryptContr = sub.getById(normalizedControllerId);
    decryptContr.onSetEncAttachements({userEmail, msgId, encAttFileNames});
  }
}
