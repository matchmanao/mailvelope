/**
 * Copyright (C) 2015-2019 Mailvelope GmbH
 * Licensed under the GNU Affero General Public License version 3
 */

import mvelo from '../lib/lib-mvelo';
import {getHash, mapError} from '../lib/util';
import * as gmail from '../modules/gmail';
import * as sub from './sub.controller';
import {getPreferredKeyringId} from '../modules/keyring';
import * as l10n from '../lib/l10n';

export default class GmailController extends sub.SubController {
  constructor(port) {
    super(port);
    if (!port) {
      this.mainType = 'gmailInt';
      this.id = getHash();
    }
    this.editorControl = null;
    this.keyringId = getPreferredKeyringId();
    this.currentAction = null;
    // register event handlers
    this.on('open-editor', this.onOpenEditor);
    this.on('secure-reply', this.onSecureReply);
    this.on('secure-forward', this.onSecureForward);
  }

  activateComponent() {
    mvelo.tabs.activate({id: this.tabId});
  }

  /**
   * Opens a new editor control and gets the recipients to encrypt plaintext
   * input to their public keys.
   * @param  {String} options.text   The plaintext input to encrypt
   */

  openEditor(options) {
    if (this.editorControl) {
      this.editorControl.activateComponent();
      return;
    }
    this.editorControl = sub.factory.get('editor');
    return this.editorControl.encrypt({
      integration: true,
      predefinedText: options.text,
      quotedMail: options.quotedMail,
      quotedMailIndent: options.quotedMailIndent === undefined ? true : options.quotedMailIndent,
      quotedMailHeader: options.quotedMailHeader,
      subject: options.subject,
      getRecipients: () => ({
        to: options.recipientsTo.map(email => ({email})),
        cc: options.recipientsCc.map(email => ({email}))
      }),
      userEmail: options.userEmail,
      attachments: options.attachments,
      keepAttachments: options.keepAttachments || false
    });
  }

  async onOpenEditor(options) {
    try {
      options.recipientsTo = options.recipientsTo || [];
      options.recipientsCc = options.recipientsCc || [];
      const {armored, encFiles, subject, to, cc} = await this.openEditor(options);
      // send email via GMAIL api
      const userEmail = options.userEmail;
      const toFormatted = to.map(({name, email}) => `${name} <${email}>`);
      const ccFormatted = cc.map(({name, email}) => `${name} <${email}>`);
      const mail = gmail.buildMail({message: armored, attachments: encFiles, subject, sender: userEmail, to: toFormatted, cc: ccFormatted});
      const scopes = [gmail.GMAIL_SCOPE_READONLY, gmail.GMAIL_SCOPE_SEND];
      const accessToken = await gmail.getAccessToken(userEmail, scopes);
      if (!accessToken) {
        this.editorControl.openAuthorizeDialog(scopes);
      } else {
        const sendOptions = {
          email: userEmail,
          message: mail,
          accessToken
        };
        if (options.threadId) {
          sendOptions.threadId = options.threadId;
        }
        const {error} = await gmail.sendMessageMeta(sendOptions);
        if (!error) {
          this.editorControl.ports.editor.emit('show-notification', {
            message: 'gmail_integration_sent_success',
            type: 'success',
            autoHide: true,
            hideDelay: 2000,
            closeOnHide: true,
            dismissable: false
          });
        } else {
          this.editorControl.ports.editor.emit('error-message', {
            error: {
              code: error.code,
              message: error.message,
              autoHide: false,
              dismissable: true
            }
          });
        }
        this.editorControl = null;
      }
    } catch (err) {
      if (err.code == 'EDITOR_DIALOG_CANCEL') {
        this.editorControl = null;
        return;
      }
      this.editorControl.ports.editor.emit('error-message', {error: mapError(err)});
    }
  }

  async onSecureReply({msgId, all, userEmail}) {
    const scopes = [gmail.GMAIL_SCOPE_READONLY, gmail.GMAIL_SCOPE_SEND];
    const accessToken = await gmail.getAccessToken(userEmail, scopes);
    if (!accessToken) {
      if (!this.tabId) {
        const {id} = await mvelo.tabs.getActive();
        this.tabId = id;
      }
      this.currentAction = {type: 'reply', msgId, all, userEmail};
      gmail.openAuthorizeDialog({email: userEmail, scopes, ctrlId: this.id});
      return;
    }
    const {threadId, internalDate, payload} = await gmail.getMessage({msgId, email: userEmail, accessToken});
    const messageText = await gmail.extractMailBody({payload, userEmail, msgId, accessToken});
    const subject = gmail.extractMailHeader(payload, 'Subject');
    const recipientsTo = [];
    const recipientsCc = [];
    const {email: sender, name: senderName} = gmail.parseEmailAddress(gmail.extractMailHeader(payload, 'From'));
    recipientsTo.push(sender);
    if (all) {
      const to = gmail.extractMailHeader(payload, 'To').split(',');
      to.map(address => gmail.parseEmailAddress(address)['email']).filter(email => email !== '' && email !== sender && email !== userEmail).forEach(email => recipientsTo.push(email));
      const cc = gmail.extractMailHeader(payload, 'Cc');
      if (cc) {
        cc.split(',').map(address => gmail.parseEmailAddress(address)['email']).filter(email => email !== '' && email !== sender && email !== userEmail).forEach(email => recipientsCc.push(email));
      }
    }
    const quotedMailHeader = l10n.get('gmail_integration_quoted_mail_header_reply', [l10n.localizeDateTime(new Date(parseInt(internalDate, 10)), {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}), `${senderName} <${sender}>`.trim()]);
    const options = {
      userEmail,
      subject: `Re: ${subject}`,
      recipientsTo,
      recipientsCc,
      threadId,
      quotedMailHeader,
      quotedMail: messageText || '',
    };
    this.onOpenEditor(options);
  }

  async onSecureForward({msgId, userEmail}) {
    const scopes = [gmail.GMAIL_SCOPE_READONLY, gmail.GMAIL_SCOPE_SEND];
    const accessToken = await gmail.getAccessToken(userEmail, scopes);
    if (!accessToken) {
      if (!this.tabId) {
        const {id} = await mvelo.tabs.getActive();
        this.tabId = id;
      }
      this.currentAction = {type: 'forward', msgId, userEmail};
      gmail.openAuthorizeDialog({email: userEmail, scopes, ctrlId: this.id});
      return;
    }
    const {threadId, internalDate, payload} = await gmail.getMessage({msgId, email: userEmail, accessToken});
    const messageText = await gmail.extractMailBody({payload, userEmail, msgId, accessToken});
    const subject = gmail.extractMailHeader(payload, 'Subject');
    const {email: sender, name: senderName} = gmail.parseEmailAddress(gmail.extractMailHeader(payload, 'From'));
    const to = gmail.extractMailHeader(payload, 'To');
    const cc = gmail.extractMailHeader(payload, 'Cc');
    let quotedMailHeader = l10n.get('gmail_integration_quoted_mail_header_forward', [`${senderName} <${sender}>`.trim(), l10n.localizeDateTime(new Date(parseInt(internalDate, 10)), {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}), subject, to.split(',').map(address => `${gmail.parseEmailAddress(address)['name']} <${gmail.parseEmailAddress(address)['email']}>`.trim()).join(', ')]);
    if (cc) {
      quotedMailHeader += `\n${l10n.get('editor_label_copy_recipient')}: ${cc.split(',').map(address => `${gmail.parseEmailAddress(address)['name']} <${gmail.parseEmailAddress(address)['email']}>`.trim()).join(', ')}`;
    }
    quotedMailHeader += '\n';
    const attachments = await gmail.getMailAttachments({payload, userEmail, msgId, accessToken});
    const options = {
      userEmail,
      subject: `Fwd: ${subject}`,
      threadId,
      quotedMail: messageText || '',
      quotedMailIndent: false,
      quotedMailHeader,
      attachments,
      keepAttachments: true
    };
    this.onOpenEditor(options);
  }

  async onAuthorize({email, scopes}) {
    try {
      await gmail.authorize(email, scopes);
      if (this.currentAction) {
        if (this.currentAction.type === 'reply') {
          this.onSecureReply(this.currentAction);
        } else if (this.currentAction.type === 'forward') {
          this.onSecureForward(this.currentAction);
        }
        this.currentAction = null;
      }
    } catch (e) {
      console.log(e);
    }
    this.activateComponent();
  }
}