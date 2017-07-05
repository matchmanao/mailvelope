/**
 * Copyright (C) 2016 Mailvelope GmbH
 * Licensed under the GNU Affero General Public License version 3
 */

/**
 * Parts of the recipient input is based on Hoodiecrow (MIT License)
 * Copyright (c) 2014 Whiteout Networks GmbH.
 * See https://github.com/tanx/hoodiecrow/blob/master/LICENSE
 */

import React from 'react';
import PropTypes from 'prop-types';
import * as l10n from '../../../lib/l10n';

'use strict';

/* global angular */

l10n.register([
  'editor_label_add_recipient'
]);

// reference to props of RecipientInput
let _props = null;
// reference to angular controller
let rInputCtrl = null;

export class RecipientInput extends React.Component {
  constructor(props) {
    super(props);
    // store props in global variable for Angular
    _props = props;
  }

  componentDidMount() {
    // load editor module dependencies
    angular.module('recipientInput', ['ngTagsInput'])
    .config(function(tagsInputConfigProvider) {
      // activate monitoring of placeholder option
      tagsInputConfigProvider.setActiveInterpolation('tagsInput', { placeholder: true });
    });
    // attach ctrl to editor module
    angular.module('recipientInput').controller('RecipientInputCtrl', RecipientInputCtrl);
    // bootstrap angular
    angular.bootstrap($('#recipients').get(0), ['recipientInput']);
  }

  shouldComponentUpdate(nextProps) {
    _props = nextProps;
    rInputCtrl.recipients = _props.recipients;
    rInputCtrl.update();
    // no re-rendering of component due to Angular
    return false;
  }

  render() {
    const contrAttr = node => {
      node.setAttribute('ng-controller', 'RecipientInputCtrl as rInput');
      node.setAttribute('ng-hide', 'rInput.embedded');
      node.setAttribute('ng-class', "{'has-error': rInput.noEncrypt}");
    };
    return (
      <div ref={node => node && contrAttr(node)}>
        <tags-input
          ng-model="rInput.recipients"
          type="email"
          allowed-tags-pattern="[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}"
          spellcheck="false"
          tabindex="1"
          add-on-space="true"
          add-on-enter="true"
          enable-editing-last-tag="true"
          display-property="displayId"
          on-tag-added="rInput.verify($tag)"
          on-tag-removed="rInput.checkEncryptStatus()"
          placeholder={l10n.map.editor_label_add_recipient}>
          <auto-complete
            source="rInput.autocomplete($query)"
            min-length="1">
          </auto-complete>
        </tags-input>
        <div className="alert alert-danger alert-dismissible ng-hide" role="alert" ref={node => node && node.setAttribute('ng-show', 'rInput.noEncrypt')}>
          <button type="button" className="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>
          <span className="glyphicon glyphicon-lock"></span>
          <strong data-l10n-id="editor_key_not_found"></strong> <span data-l10n-id="editor_key_not_found_msg"></span>
        </div>
      </div>
    );
  }
}

RecipientInput.propTypes = {
  keys: PropTypes.array,
  recipients: PropTypes.array,
  onChangeEncryptStatus: PropTypes.func,
  onLookupKeyOnServer: PropTypes.func
};

/**
 * Angular controller for the recipient input
 */
export class RecipientInputCtrl {
  constructor($timeout) {
    this._timeout = $timeout;
    this.recipients = _props.recipients;
    rInputCtrl = this;
  }

  update() {
    this._timeout(() => { // trigger $scope.$digest() after async call
      this.recipients.forEach(this.verify.bind(this));
      this.checkEncryptStatus();
    });
  }

  /**
   * Verifies a recipient after input, gets their key, colors the
   * input tag accordingly and checks if encryption is possible.
   * @param  {Object} recipient   The recipient object
   */
  verify(recipient) {
    if (!recipient) {
      return;
    }
    if (recipient.email) {
      // display only address from autocomplete
      recipient.displayId = recipient.email;
    } else {
      // set address after manual input
      recipient.email = recipient.displayId;
    }
    // lookup key in local cache
    recipient.key = this.getKey(recipient);
    if (recipient.key || recipient.checkedServer || !_props.tofu) {
      // color tag only if a local key was found, or after server lookup,
      // or if TOFU (Trust on First Use) is deactivated
      this.colorTag(recipient);
      this.checkEncryptStatus();
    } else {
      // no local key found ... lookup on the server
      this.lookupKeyOnServer(recipient);
    }
  }

  /**
   * Finds the recipient's corresponding public key and sets it
   * on the 'key' attribute on the recipient object.
   * @param  {Object} recipient   The recipient object
   * @return {Object}             The key object (undefined if none found)
   */
  getKey(recipient) {
    return _props.keys.find(key => {
      if (key.email && recipient.email) {
        return key.email.toLowerCase() === recipient.email.toLowerCase();
      }
    });
  }

  /**
   * Uses jQuery to color the recipient's input tag depending on
   * whether they have a key or not.
   * @param  {Object} recipient   The recipient object
   */
  colorTag(recipient) {
    this._timeout(() => { // wait for html tag to appear
      $('tags-input li.tag-item').each(function() {
        if ($(this).text().indexOf(recipient.email) === -1) {
          return;
        }
        if (recipient.key) {
          $(this).addClass('tag-success');
        } else {
          $(this).addClass('tag-danger');
        }
      });
    });
  }

  /**
   * Checks if all recipients have a public key and prevents encryption
   * if one of them does not have a key.
   */
  checkEncryptStatus() {
    this.noEncrypt = this.recipients.some(r => !r.key);
    _props.onChangeEncryptStatus({encryptDisabled: this.noEncrypt || !this.recipients.length});
  }

  /**
   * Do TOFU (trust on first use) lookup on the Mailvelope Key Server
   * if a key was not found in the local keyring.
   * @param  {Object} recipient   The recipient object
   * @return {undefined}
   */
  lookupKeyOnServer(recipient) {
    recipient.checkedServer = true;
    _props.onLookupKeyOnServer(recipient);
  }

  /**
   * Queries the local cache of key objects to find a matching user ID
   * @param  {String} query   The autocomplete query
   * @return {Array}          A list of filtered items that match the query
   */
  autocomplete(query) {
    var cache = _props.keys.map(key => {
      return {
        email: key.email,
        displayId: key.userid + ' - ' + key.keyid.toUpperCase()
      };
    });
    // filter by display ID and ignore duplicates
    return cache.filter(i => {
      return i.displayId.toLowerCase().includes(query.toLowerCase()) &&
        !this.recipients.some(recipient => recipient.email === i.email);
    });
  }

}

// workaround to prevent "Error: class constructors must be invoked with |new|" in Firefox
// https://github.com/angular/angular.js/issues/14240
RecipientInputCtrl.$$ngIsClass = true;