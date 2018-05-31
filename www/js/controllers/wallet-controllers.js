angular.module('cesium.wallet.controllers', ['cesium.services', 'cesium.currency.controllers'])

  .config(function($stateProvider) {
    'ngInject';
    $stateProvider


      .state('app.view_wallet', {
        url: "/wallet?refresh",
        views: {
          'menuContent': {
            templateUrl: "templates/wallet/view_wallet.html",
            controller: 'WalletCtrl'
          }
        },
        data: {
          login: true
        }
      })

      .state('app.view_wallet_tx', {
        url: "/history?refresh",
        views: {
          'menuContent': {
            templateUrl: "templates/wallet/view_wallet_tx.html",
            controller: 'WalletTxCtrl'
          }
        },
        data: {
          login: true,
          silentLocationChange: true
        }
      })

      .state('app.view_wallet_tx_errors', {
        url: "/wallet/tx/errors",
        views: {
          'menuContent': {
            templateUrl: "templates/wallet/view_wallet_tx_error.html",
            controller: 'WalletTxErrorCtrl'
          }
        },
        data: {
          login: true
        }
      })
    ;
  })


  .controller('WalletCtrl', WalletController)

  .controller('WalletTxCtrl', WalletTxController)

  .controller('WalletTxErrorCtrl', WalletTxErrorController)

  .controller('WalletSecurityModalCtrl', WalletSecurityModalController)
;

function WalletController($scope, $rootScope, $q, $ionicPopup, $timeout, $state, $translate, $ionicPopover,
                          UIUtils, Modals, BMA, csConfig, csSettings, csWallet, csHelp) {
  'ngInject';

  $scope.loading = true;
  $scope.settings = csSettings.data;
  $scope.qrcodeId = 'qrcode-wallet-' + $scope.$id;

  $scope.$on('$ionicView.enter', function(e, state) {
    $scope.loading = $scope.loading || (state.stateParams && state.stateParams.refresh);
    if ($scope.loading) { // load once
      return $scope.load();
    }
    else {
      // update view (to refresh avatar + plugin data, such as profile, subscriptions...)
      UIUtils.loading.hide();
      $timeout($scope.updateView, 300);
    }
  });

  $scope.load = function() {
    return $scope.loadWallet()
      .then(function(walletData) {
        $scope.formData = walletData;
        $scope.loading=false; // very important, to avoid TX to be display before wallet.currentUd is loaded
        $scope.updateView();
        $scope.showQRCode();
        $scope.showHelpTip();
        UIUtils.loading.hide(); // loading could have be open (e.g. new account)
      })
      .catch(function(err){
        if (err == 'CANCELLED') {
          $scope.showHome();
        }
      });
  };

  $scope.updateView = function() {
    $scope.motion.show({selector: '#wallet .item'});
    $scope.$broadcast('$$rebind::' + 'rebind'); // force rebind
  };
  // Listen new events (can appears from security wizard also)
  $scope.$watchCollection('formData.events', function(newEvents, oldEvents) {
    if (!oldEvents || $scope.loading || angular.equals(newEvents, oldEvents)) return;
    $scope.updateView();
  });

  $scope.setRegisterForm = function(registerForm) {
    $scope.registerForm = registerForm;
  };

  // Clean controller data when logout
  $scope.onWalletLogout = function() {
    // clean QRcode
    $scope.hideQRCode('qrcode');
    delete $scope.formData;
    $scope.loading = true;
  };
  csWallet.api.data.on.logout($scope, $scope.onWalletLogout);

  // Ask uid
  $scope.showUidPopup = function() {
    return $q(function(resolve, reject) {
      $translate(['ACCOUNT.NEW.TITLE', 'ACCOUNT.POPUP_REGISTER.TITLE', 'ACCOUNT.POPUP_REGISTER.HELP', 'COMMON.BTN_OK', 'COMMON.BTN_CANCEL'])
        .then(function (translations) {
          $scope.formData.newUid = (!!$scope.formData.uid ? ''+$scope.formData.uid : '');

          // Choose UID popup
          $ionicPopup.show({
            templateUrl: 'templates/wallet/popup_register.html',
            title: translations['ACCOUNT.POPUP_REGISTER.TITLE'],
            subTitle: translations['ACCOUNT.POPUP_REGISTER.HELP'],
            scope: $scope,
            buttons: [
              { text: translations['COMMON.BTN_CANCEL'] },
              {
                text: translations['COMMON.BTN_OK'],
                type: 'button-positive',
                onTap: function(e) {
                  $scope.registerForm.$submitted=true;
                  if(!$scope.registerForm.$valid || !$scope.formData.newUid) {
                    //don't allow the user to close unless he enters a uid
                    e.preventDefault();
                  } else {
                    return $scope.formData.newUid;
                  }
                }
              }
            ]
          })
          .then(function(uid) {
            if (!uid) { // user cancel
              delete $scope.formData.uid;
              UIUtils.loading.hide();
              return;
            }
            resolve(uid);
          });
        });
      });
  };

  // Send self identity
  $scope.self = function() {
    $scope.hideActionsPopover();

    return $scope.showUidPopup()
    .then(function(uid) {
      UIUtils.loading.show();

      return csWallet.self(uid)
      .then(function() {
        $scope.updateView();
        UIUtils.loading.hide();
      })
      .catch(function(err){
         UIUtils.onError('ERROR.SEND_IDENTITY_FAILED')(err)
         .then(function() {
           $scope.self(); // loop
         });
      });
    });
  };

  $scope.doMembershipIn = function(retryCount) {
    return csWallet.membership.inside()
      .then(function() {
        $scope.updateView();
        UIUtils.loading.hide();
      })
      .catch(function(err) {
        if (err == 'CANCELLED') throw err;
        if (err && err.ucode != BMA.errorCodes.MEMBERSHIP_ALREADY_SEND) return;
        if (!retryCount || retryCount <= 2) {
          return $timeout(function() {
            $scope.doMembershipIn(retryCount ? retryCount+1 : 1);
          }, 1000);
        }
        throw err;
      });
  };


  // Send membership IN
  $scope.membershipIn = function(keepSelf) {
    $scope.hideActionsPopover();

    if (csWallet.isMember()) {
      return UIUtils.alert.info("INFO.NOT_NEED_MEMBERSHIP");
    }

    // Select uid (or reuse it)
    return ((keepSelf && !!$scope.formData.blockUid) ?
        $q.when($scope.formData.uid) :
        $scope.showUidPopup())

      // Ask user confirmation
      .then(function(uid) {
        return UIUtils.alert.confirm("CONFIRM.MEMBERSHIP")
          .then(function(confirm) {
            if (!confirm) throw 'CANCELLED';
            return uid;
          });
      })

      // Send self (identity) - if need
      .then(function (uid) {
        UIUtils.loading.show();

        // If uid changed, or self blockUid not retrieve : do self() first
        if (!$scope.formData.blockUid || uid != $scope.formData.uid) {
          $scope.formData.blockUid = null;
          $scope.formData.uid = uid;

          return csWallet.self(uid, false/*do NOT load membership here*/);
        }
      })

      // Send membership
      .then($scope.doMembershipIn)
      .catch(function(err) {
        if (err == 'CANCELLED') return;
        if (!csWallet.data.uid) {
          UIUtils.onError('ERROR.SEND_IDENTITY_FAILED')(err);
        }
        else {
          UIUtils.onError('ERROR.SEND_MEMBERSHIP_IN_FAILED')(err);
        }
      });
  };

  // Send membership OUT
  $scope.membershipOut = function(confirm, confirmAgain) {
    $scope.hideActionsPopover();

    // Ask user confirmation
    if (!confirm) {
      return UIUtils.alert.confirm('CONFIRM.MEMBERSHIP_OUT', 'CONFIRM.POPUP_WARNING_TITLE', {
        cssClass: 'warning',
        okText: 'COMMON.BTN_YES',
        okType: 'button-assertive'
      })
      .then(function(confirm) {
        if (confirm) $scope.membershipOut(true); // loop with confirmation
      });
    }

    if (!confirmAgain) {
      return UIUtils.alert.confirm("CONFIRM.MEMBERSHIP_OUT_2", 'CONFIRM.POPUP_TITLE', {
        cssClass: 'warning',
        okText: 'COMMON.BTN_YES',
        okType: 'button-assertive'
      })
      .then(function (confirm) {
        if (confirm) $scope.membershipOut(true, true); // loop with all confirmations
      });
    }

    UIUtils.loading.show();
    return csWallet.membership.out()
      .then(function() {
        UIUtils.loading.hide();
        UIUtils.toast.show('INFO.MEMBERSHIP_OUT_SENT');
    })
    .catch(UIUtils.onError('ERROR.SEND_MEMBERSHIP_OUT_FAILED'));
  };

  // Updating wallet data
  $scope.doUpdate = function(silent) {
    console.debug('[wallet] Refreshing data...');
    return (silent ?
        csWallet.refreshData() :
        UIUtils.loading.show()
          .then(csWallet.refreshData)
          .then(UIUtils.loading.hide)
      )
      .then($scope.updateView)
      .catch(UIUtils.onError('ERROR.REFRESH_WALLET_DATA'));
  };

  /**
   * Renew membership
   */
  $scope.renewMembership = function(confirm) {

    if (!$scope.formData.isMember && !$scope.formData.requirements.wasMember) {
      return UIUtils.alert.error("ERROR.ONLY_MEMBER_CAN_EXECUTE_THIS_ACTION");
    }
    if (!confirm && !$scope.formData.requirements.needRenew) {
      return $translate("CONFIRM.NOT_NEED_RENEW_MEMBERSHIP", {membershipExpiresIn: $scope.formData.requirements.membershipExpiresIn})
        .then(function(message) {
          return UIUtils.alert.confirm(message);
        })
        .then(function(confirm) {
          if (confirm) $scope.renewMembership(true); // loop with confirm
        });
    }

    return csWallet.auth({minData: true}) // Ask user to auth, before confirmation - fix #508
      .then(function() {
        UIUtils.loading.hide();
        return UIUtils.alert.confirm("CONFIRM.RENEW_MEMBERSHIP");
      })
      .then(function(confirm) {
        if (confirm) {
          UIUtils.loading.show();
          return $scope.doMembershipIn();
        }
      })
      .catch(function(err){
        if (err == 'CANCELLED') return;
        UIUtils.loading.hide();
        UIUtils.alert.error(err);
      });
  };


  /**
   * Fix identity (e.g. when identity expired)
   */
  $scope.fixIdentity = function() {
    if (!$scope.formData.uid) return;

    return $q.all([
      csWallet.auth(),
      $translate('CONFIRM.FIX_IDENTITY', {uid: $scope.formData.uid})
    ])
      .then(function(res) {
        return UIUtils.alert.confirm(res[1]);
      })
      .then(function(confirm) {
        if (!confirm) return;
        UIUtils.loading.show();
        // Reset self data
        $scope.formData.blockUid = null;
        // Reset membership data
        $scope.formData.sigDate = null;
        return csWallet.self($scope.formData.uid);
      })
      .then($scope.doMembershipIn)
      .catch(function(err){
        if (err == 'CANCELLED') return;
        UIUtils.loading.hide();
        UIUtils.alert.error(err);
      });
  };

  /**
   * Fix membership, when existing MS reference an invalid block
   */
  $scope.fixMembership = function() {
    if (!$scope.formData.uid) return;

    if (csWallet.isMember()) {
      return UIUtils.alert.info("INFO.NOT_NEED_MEMBERSHIP");
    }

    return csWallet.auth()
      .then(function() {
        UIUtils.alert.confirm("CONFIRM.FIX_MEMBERSHIP");
      })
      .then(function(confirm) {
        if (!confirm) return;
        UIUtils.loading.show();
        // Reset self data
        $scope.formData.blockUid = null;
        // Reset membership data
        $scope.formData.sigDate = null;
        return csWallet.self($scope.formData.uid, false/*do NOT load membership here*/);
      })
      .then($scope.doMembershipIn)
      .catch(function(err){
        if (err == 'CANCELLED') return;
        UIUtils.loading.hide();
        UIUtils.alert.error(err);
      });
  };

  /**
   * Catch click for quick fix
   * @param fix
   */
  $scope.doQuickFix = function(event) {
    if (event == 'renew') {
      $scope.renewMembership();
    }
    else if (event == 'membership') {
      $scope.membershipIn(true/*keep self*/);
    }
    else if (event == 'fixMembership') {
      $scope.fixMembership();
    }
    else if (event == 'fixIdentity') {
      $scope.fixIdentity();
    }
  };

  /* -- popup / UI -- */

  // Transfer
  $scope.showTransferModal = function() {
    var hasCredit = (!!$scope.formData.balance && $scope.formData.balance > 0);
    if (!hasCredit) {
      UIUtils.alert.info('INFO.NOT_ENOUGH_CREDIT');
      return;
    }
    Modals.showTransfer()
      .then(function(done){
        if (done) {
          UIUtils.toast.show('INFO.TRANSFER_SENT');
          $scope.$broadcast('$$rebind::' + 'balance'); // force rebind balance
          $scope.motion.show({selector: '.item-pending'});
        }
      });
  };

  $scope.startWalletTour = function() {
    $scope.hideActionsPopover();
    return csHelp.wallet.tour();
  };

  $scope.showHelpTip = function() {
    return csHelp.wallet.helptip();
  };

  $scope.showQRCode = function(timeout) {
    if (!$scope.qrcode) {
      $scope.qrcode = new QRCode(
        $scope.qrcodeId,
        {
          text: $scope.formData.pubkey,
          width: 200,
          height: 200,
          correctLevel: QRCode.CorrectLevel.L
        });
      UIUtils.motion.toggleOn({selector: '#'+$scope.qrcodeId}, timeout || 1100);
    }
    else {
      $scope.qrcode.clear();
      $scope.qrcode.makeCode($scope.formData.pubkey);
      UIUtils.motion.toggleOn({selector: '#'+$scope.qrcodeId}, timeout || 1100);
    }
  };

  $scope.hideQRCode = function(id) {
    if ($scope.qrcode) {
      $scope.qrcode.clear();
      UIUtils.motion.toggleOff({selector: '#'+$scope.qrcodeId});
    }
  };

  $scope.showCertifications = function() {
    // Warn: do not use a simple link here (a ng-click is mandatory for help tour)
    $state.go(UIUtils.screen.isSmall() ? 'app.wallet_cert' : 'app.wallet_cert_lg', {
      pubkey: $scope.formData.pubkey,
      uid: $scope.formData.name || $scope.formData.uid,
      type: 'received'
    });
  };

  $scope.showGivenCertifications = function() {
    // Warn: do not use a simple link here (a ng-click is mandatory for help tour)
      $state.go(UIUtils.screen.isSmall() ? 'app.wallet_cert' : 'app.wallet_cert_lg', {
        pubkey: $scope.formData.pubkey,
        uid: $scope.formData.name || $scope.formData.uid,
        type: 'given'
    });
  };

  $scope.showActionsPopover = function(event) {
    if (!$scope.actionsPopover) {
      $ionicPopover.fromTemplateUrl('templates/wallet/popover_actions.html', {
        scope: $scope
      }).then(function(popover) {
        $scope.actionsPopover = popover;
        //Cleanup the popover when we're done with it!
        $scope.$on('$destroy', function() {
          $scope.actionsPopover.remove();
        });
        $scope.actionsPopover.show(event);
      });
    }
    else {
      $scope.actionsPopover.show(event);
    }
  };

  $scope.hideActionsPopover = function() {
    if ($scope.actionsPopover) {
      $scope.actionsPopover.hide();
    }
  };

  $scope.showSharePopover = function(event) {
    $scope.hideActionsPopover();

    var title = $scope.formData.name || $scope.formData.uid || $scope.formData.pubkey;
    // Use shareBasePath (fix #530) or rootPath (fix #390)
    var url = (csConfig.shareBaseUrl || $rootScope.rootPath) + $state.href('app.wot_identity', {pubkey: $scope.formData.pubkey, uid: $scope.formData.name || $scope.formData.uid});

    // Override default position, is small screen - fix #545
    if (UIUtils.screen.isSmall()) {
      event = angular.element(document.querySelector('#wallet-share-anchor')) || event;
    }

    UIUtils.popover.share(event, {
      bindings: {
        url: url,
        titleKey: 'WOT.VIEW.POPOVER_SHARE_TITLE',
        titleValues: {title: title},
        postMessage: title
      }
    });
  };

  $scope.showSecurityModal = function(){
    $scope.hideActionsPopover();
    return Modals.showAccountSecurity()
      .then(function(res) {
        if (!res) return;

        if (res === 'self') {
          return $scope.self();
        }
        else if (res === 'membershipIn') {
          return $scope.membershipIn();
        }
      });
  };

  $scope.showSelectIdentitiesModal = function(){
    $scope.hideActionsPopover();

    return Modals.showSelectPubkeyIdentity({
        identities: [$scope.formData.requirements].concat($scope.formData.requirements.alternatives)
      })
      .then(function(idty) {
        if (!idty || !idty.uid) return;

        $scope.loading = true;

        // Set self (= uid + blockUid)
        return csWallet.setSelf(idty.uid, idty.blockUid)
          .then(function() {
            $scope.loading=false;
            $scope.updateView();
            UIUtils.loading.hide();
          });
      });
  };

}


function WalletTxController($scope, $ionicPopover, $state, $timeout, $location,
                            UIUtils, Modals, BMA, csSettings, csWallet, csTx) {
  'ngInject';

  $scope.loading = true;
  $scope.settings = csSettings.data;

  $scope.$on('$ionicView.enter', function(e, state) {
    $scope.loading = $scope.loading || (state.stateParams && state.stateParams.refresh);
    if ($scope.loading) {
      $scope.loadWallet()
        .then(function (res) {
          $scope.formData = res;
          $scope.loading = false; // very important, to avoid TX to be display before wallet.currentUd is loaded
          $scope.updateView();
          $scope.showFab('fab-transfer');
          $scope.showHelpTip();
          UIUtils.loading.hide(); // loading could have be open (e.g. new account)

          // remove the stateParams
          if (state.stateParams && state.stateParams.refresh) {
            $location.search({}).replace();
          }
        })
        .catch(function (err) {
          if (err == 'CANCELLED') {
            $scope.showHome();
          }
        });
    }
    else {
      // Make sure to display new pending (e.g. sending using another screen button)
      $timeout($scope.updateView, 300);
    }
  });


  // Update view
  $scope.updateView = function() {
    if (!$scope.formData || $scope.loading) return;
    $scope.$broadcast('$$rebind::' + 'balance'); // force rebind balance
    $scope.$broadcast('$$rebind::' + 'rebind'); // force rebind
    $scope.motion.show({selector: '.view-wallet-tx .item', ink: false});
  };

  $scope.downloadHistoryFile = function(options) {
    options = options || {};
    options.fromTime = options.fromTime || -1; // default: full history
    var pubkey = $scope.formData.pubkey;
    csTx.downloadHistoryFile(pubkey, options);
  };

  // Updating wallet data
  $scope.doUpdate = function(silent) {
    console.debug('[wallet] TX history reloading...');
    return (silent ?
        csWallet.refreshData() :
        UIUtils.loading.show()
          .then(csWallet.refreshData)
          .then(UIUtils.loading.hide)
      )
      .then($scope.updateView)
      .catch(UIUtils.onError('ERROR.REFRESH_WALLET_DATA'));
  };

  /* -- add listeners -- */

  csWallet.api.data.on.balanceChanged($scope, $scope.updateView);
  $scope.$watch('settings.useRelative', $scope.updateView);
  $scope.$watch('settings.showUDHistory', function() {
    // Reload if show UD changed
    if (!$scope.formData || $scope.loading) return;
      $scope.doUpdate();
    }, true);

  /* -- popup / UI -- */

  // Transfer
  $scope.showTransferModal = function() {
    var hasCredit = (!!$scope.formData.balance && $scope.formData.balance > 0);
    if (!hasCredit) {
      UIUtils.alert.info('INFO.NOT_ENOUGH_CREDIT');
      return;
    }
    return Modals.showTransfer();
  };

  $scope.showHelpTip = function(index, isTour) {
    // TODO
  };

  $scope.showMoreTx = function(fromTime) {

    fromTime = fromTime ||
      ($scope.formData.tx.fromTime - csSettings.data.walletHistoryTimeSecond) ||
      (Math.trunc(new Date().getTime() / 1000) - 2 * csSettings.data.walletHistoryTimeSecond);

    UIUtils.loading.show();
    return csWallet.refreshData({tx: {enable: true,fromTime: fromTime}})
      .then(function() {
        $scope.updateView();
        UIUtils.loading.hide();
      })
      .catch(function(err) {
        // If http rest limitation: wait then retry
        if (err.ucode == BMA.errorCodes.HTTP_LIMITATION) {
          $timeout(function() {
            return $scope.showMoreTx(fromTime);
          }, 2000);
        }
        else {
          UIUtils.onError('ERROR.REFRESH_WALLET_DATA')(err);
        }
      });
  };

  /* -- popover -- */

  var paddingIndent = 10;

  $scope.toUnlockUIArray = function(unlockTreeItem, leftPadding, operator) {
    leftPadding = leftPadding || 0;

    // If operator (AND, OR)
    if (unlockTreeItem.children && (unlockTreeItem.type == 'AND' || unlockTreeItem.type == 'OR')) {
      return unlockTreeItem.children.reduce(function(res, child, index){
        if (child.children && index > 0) {
          // Add space between expression block
          res = res.concat({
            style: {
              'padding-left': leftPadding + 'px',
              'padding-top': '10px',
              'padding-bottom': '10px'
            },
            operator: unlockTreeItem.type
          });

          return res.concat($scope.toUnlockUIArray(child, leftPadding + paddingIndent));
        }
        return res.concat($scope.toUnlockUIArray(child, leftPadding + paddingIndent, index && unlockTreeItem.type));
      }, []);
    }

    return {
      style: {
        'padding-left': leftPadding + 'px'
      },
      operator: operator,
      type: unlockTreeItem.type,
      value: unlockTreeItem.value
    };
  };

  $scope.showLockedOutputsPopover = function(tx, event) {
    if (!tx.lockedOutputs) return;

    // Convert condition into UI array
    $scope.popoverData = $scope.popoverData || {};
    $scope.popoverData.lockedOuputs = tx.lockedOutputs.reduce(function(res, lockedOutput){
      return res.concat({
        amount: lockedOutput.amount,
        unlockFunctions: lockedOutput.unlockFunctions,
        unlockConditions: $scope.toUnlockUIArray(lockedOutput.unlockTree)
      });
    }, []);

    // Open popover
    if (!$scope.lockedOutputsPopover) {
      $ionicPopover.fromTemplateUrl('templates/wallet/tx_locked_outputs_popover.html', {
        scope: $scope
      }).then(function(popover) {
        $scope.lockedOutputsPopover = popover;
        //Cleanup the popover when we're done with it!
        $scope.$on('$destroy', function() {
          $scope.lockedOutputsPopover.remove();
        });
        $scope.lockedOutputsPopover.show(event);
      });
    }
    else {
      $scope.lockedOutputsPopover.show(event);
    }
  };

  $scope.hideLockedOutputsPopover = function() {
    if ($scope.lockedOutputsPopover) {
      $scope.lockedOutputsPopover.hide();
      if ($scope.popoverData) {
        delete $scope.popoverData.unlockConditions;
      }
    }
  };

  $scope.goState = function(stateName, stateParams) {
    $scope.hideLockedOutputsPopover();
    $state.go(stateName, stateParams);
  };
}

function WalletTxErrorController($scope, UIUtils, csWallet) {
  'ngInject';

  $scope.formData = {};

  $scope.$on('$ionicView.enter', function(e) {
    $scope.loadWallet()
      .then(function(walletData) {
        $scope.formData = walletData;
        $scope.doMotion();
        $scope.showFab('fab-redo-transfer');
        UIUtils.loading.hide();
      });
  });

  // Updating wallet data
  $scope.doUpdate = function(silent) {

    return (silent ?
        csWallet.refreshData() :
        UIUtils.loading.show()
          .then(csWallet.refreshData)
          .then(UIUtils.loading.hide)
      )
      .then($scope.doMotion)
      .catch(UIUtils.onError('ERROR.REFRESH_WALLET_DATA'));
  };

  $scope.filterReceivedTx = function(tx){
    return tx.amount && tx.amount > 0;
  };

  $scope.filterSentTx = function(tx){
    return tx.amount && tx.amount < 0;
  };

}

function WalletSecurityModalController($scope, UIUtils, csWallet, $translate){

  $scope.slides = {
    slider: null,
    options: {
      loop: false,
      effect: 'slide',
      speed: 500
    }
  };
  $scope.isLastSlide = false;
  $scope.smallscreen = UIUtils.screen.isSmall();

  $scope.recover = {};
  $scope.isValidFile = false;

  $scope.isLogin = csWallet.isLogin();
  $scope.hasSelf = csWallet.hasSelf();
  $scope.needSelf = $scope.isLogin && csWallet.data.requirements.needSelf;
  $scope.needMembership = $scope.isLogin && csWallet.data.requirements.needMembership;
  $scope.option = $scope.isLogin ? 'saveID' : 'recoverID';

  $scope.formData = {
    addQuestion: '',
    level: '4',
    questions : []
  };
  var questions = [];
  for (var i = 1; i<20; i++) {
    questions.push('ACCOUNT.SECURITY.QUESTION_' + i.toString());
  }
  $translate(questions)
    .then(function(translations){
      _.each(translations, function(translation){
        $scope.formData.questions.push({value: translation , checked: false});
      });
    });


  $scope.slidePrev = function() {
    $scope.slides.slider.unlockSwipes();
    $scope.slides.slider.slidePrev();
    $scope.slides.slider.lockSwipes();
    $scope.isLastSlide = false;

  };

  $scope.slideNext = function() {
    $scope.slides.slider.unlockSwipes();
    $scope.slides.slider.slideNext();
    $scope.slides.slider.lockSwipes();
    $scope.isLastSlide = ($scope.slides.slider.activeIndex === 3 && ($scope.option == "saveID" || $scope.option == "recoverID")) || ($scope.slides.slider.activeIndex === 2 && $scope.option == "revocation");
  };


  $scope.doNext = function(formName) {
    if (!formName) {
      switch ($scope.slides.slider.activeIndex) {
        case 1:
          switch ($scope.option) {
            case "saveID":
              formName = "questionsForm";
              break;
            case "recoverID":
              if ($scope.isValidFile) {
                $scope.slideNext();
                $scope.hasContent = false;
                $scope.fileData = '';

              }
              else {
                UIUtils.alert.error("ERROR.NOT_VALID_SAVE_ID_FILE", "ERROR.LOAD_FILE_FAILED");
              }
              break;
          }
          break;

        case 2:
          switch ($scope.option) {
            case "recoverID":
              formName = "recoverForm";
              break;
            case "saveID":
              formName = "answersForm";
              break;
          }
      }
    }

    if (formName) {
      $scope[formName].$submitted = true;
      if (!$scope[formName].$valid) {
        return;
      }
      switch (formName) {
        case "recoverForm":
          $scope.recoverId();
          break;
        case "answersForm":
          $scope.downloadSaveIDFile();
          break;
        default:
          $scope.slideNext();
      }
    }
  };

  $scope.selectOption = function(option){
    $scope.option = option;
    $scope.slideNext();
  };

  $scope.restore = function(){
    if ($scope.slides.slider.activeIndex === 1 && $scope.option === 'saveID') {
      $scope.formData = {
        addQuestion: '',
        level: '4',
        questions: []
      };
      $translate(questions)
        .then(function (translations) {
          _.each(translations, function (translation) {
            $scope.formData.questions.push({value: translation, checked: false});
          });
        });
    }

    else if ($scope.slides.slider.activeIndex === 2 && $scope.option === 'saveID') {
      _.each($scope.formData.questions, function(question){
        question.answer = undefined;
      });
    }

    else if ($scope.slides.slider.activeIndex === 1 && $scope.option === 'recoverID'){
      $scope.hasContent = false;
      $scope.recover = {};
      $scope.fileData =  '';
      $scope.isValidFile = false;
    }

    else if ($scope.slides.slider.activeIndex === 2 && $scope.option === 'recoverID'){
      _.each($scope.recover.questions, function(element){
        element.answer = undefined;
      });
    }

    else if ($scope.slides.slider.activeIndex === 2 && $scope.option === 'revocation'){
      $scope.isValidFile = false;
      $scope.hasContent = false;
      $scope.revocation = undefined;
    }
  };

  /**
   * Recover Id
   */

  $scope.recoverContent = function(file) {
    $scope.hasContent = angular.isDefined(file) && file !== '';
    $scope.fileData = file.fileData ? file.fileData : '';
    $scope.isValidFile = $scope.fileData !== '' && $scope.fileData.type == 'text/plain';

    if ($scope.isValidFile && $scope.option === 'recoverID') {
      $scope.content = file.fileContent.split('\n');
      var indexOfQuestions = _.indexOf($scope.content, 'Questions: ');
      var LastIndexQuestions = -1;
      _.each($scope.content, function (element, index) {
        if (/^Issuer:/.test(element)) {
          LastIndexQuestions = index;
        }
        else if (/^Crypted-Nonce:/.test(element)) {
          $scope.recover.cypherNonce = element.split(' ')[1];
        }
        else if (/^Crypted-Pubkey:/.test(element)) {
          $scope.recover.cypherPubkey = element.split(' ')[1];
        }
        else if (/^Crypted-Salt:/.test(element)) {
          $scope.recover.cypherSalt = element.split(' ')[1];
        }
        else if (/^Crypted-Pwd:/.test(element)) {
          $scope.recover.cypherPwd = element.split(' ')[1];
        }
      });
      $scope.recover.questions = [];
      for (var i = indexOfQuestions + 1; i < LastIndexQuestions; i++) {
        $scope.recover.questions.push({value: $scope.content[i]});
      }
    }
    else if ($scope.isValidFile && $scope.option === "revocation"){
      $scope.revocation = file.fileContent;
    }
  };

  $scope.recoverId = function(){
    if(!$scope.recoverForm.$valid){
      return;
    }

    $scope.recover.answer = '';
    _.each($scope.recover.questions, function(element){
      $scope.recover.answer += element.answer;
    });

    return csWallet.recoverId($scope.recover)
      .then(function (recover){
        if (angular.isDefined(recover)) {
          $scope.recover = recover;
          $scope.slideNext();
        }
        else {
          UIUtils.alert.error('ERROR.RECOVER_ID_FAILED');
        }
      });

  };

  /**
   * Save Id
   */
  $scope.addQuestion = function(){
    if ($scope.formData.addQuestion !== '') {
      $scope.formData.questions.push({value: $scope.formData.addQuestion, checked: true});
      $scope.formData.addQuestion = '';
    }
  };

  $scope.downloadSaveIDFile = function(){
    // Force user re-auth
    var loginData;
    return csWallet.auth({
        forceAuth: true,
        expectedPubkey: $scope.pubkey,
        silent: true,
        success: function(values) {
          loginData = values;
        }
      })
      .catch(function(err) {
        if (err && err == 'CANCELLED') return;
        UIUtils.alert.error('ERROR.SALT_OR_PASSWORD_NOT_CONFIRMED', 'ERROR.LOGIN_FAILED');
        return;
      })
      .then(function(res) {
        if (!res) return;
        var file = {
          file: _.filter($scope.formData.questions, function (question) {
            return question.checked;
          })
        };
        var record = {
          salt: loginData.username,
          pwd: loginData.password,
          questions: '',
          answer: ''
        };
        _.each(file.file, function (question) {
          record.questions += question.value + '\n';
          record.answer += question.answer;
        });

        return csWallet.getCryptedId(record)
          .then(function(record){
            csWallet.downloadSaveId(record);
            $scope.closeModal();
          });
      })
      ;
  };

  $scope.isRequired = function(){
    var questionChecked = _.filter($scope.formData.questions, function(question) {
      return question.checked;
    });
    return questionChecked.length < $scope.formData.level;
  };

  $scope.revokeWithFile = function(){
    if ($scope.isValidFile) {
        $scope.revokeIdentity();
      }
      else {
        UIUtils.alert.error("ERROR.NOT_VALID_REVOCATION_FILE", "ERROR.LOAD_FILE_FAILED");
      }
  };

  /**
   * Download revocation file
   */
  $scope.downloadRevokeFile = function () {
    // Force re-authentication
    return csWallet.auth({forceAuth: true})

      // Download file
      .then(function() {
        return csWallet.downloadRevocation();
      })

      .then(function() {
        UIUtils.loading.hide();
      })

      .catch(function(err){
        if (err && err == 'CANCELLED') return;
        UIUtils.onError('ERROR.DOWNLOAD_REVOCATION_FAILED')(err);
      })
      ;

  };

  /**
   * Revoke wallet identity
   */
  $scope.revokeWalletIdentity = function () {
    if (!$scope.hasSelf) {
      return UIUtils.alert.error("ERROR.ONLY_SELF_CAN_EXECUTE_THIS_ACTION");
    }

    // Make sure user re-auth
    return csWallet.auth({forceAuth: true})
      .then(function(confirm) {
        UIUtils.loading.hide();
        if (!confirm) return;
        return $scope.revokeIdentity();
      })
      .catch(function (err) {
        if (err == 'CANCELLED') return;
        UIUtils.onError('ERROR.REVOCATION_FAILED')(err);
      });
  };

  /**
   * Revoke identity
   */
  $scope.revokeIdentity = function (confirm) {

    // Make sure user re-auth + confirm
    if (!confirm) {
        return UIUtils.alert.confirm("CONFIRM.REVOKE_IDENTITY", 'CONFIRM.POPUP_WARNING_TITLE', {
          cssClass: 'warning',
          okText: 'COMMON.BTN_YES',
          okType: 'button-assertive'
        })
        .then(function (confirm) {
          if (!confirm) return;
          return UIUtils.alert.confirm("CONFIRM.REVOKE_IDENTITY_2", 'CONFIRM.POPUP_TITLE', {
            cssClass: 'warning',
            okText: 'COMMON.BTN_YES',
            okType: 'button-assertive'
          });
        })
        .then(function (confirm) {
          if (confirm) $scope.revokeIdentity(true, true); // loop with confirmation
        });
    }

    return UIUtils.loading.show()
      .then(function () {
        if (!$scope.revocation){
          return csWallet.revoke();
        }
        else {
          return csWallet.revokeWithFile($scope.revocation);
        }
      })
      .then(function () {
        UIUtils.toast.show("INFO.REVOCATION_SENT");
        $scope.closeModal();
        return UIUtils.loading.hide();
      })
      .catch(UIUtils.onError('ERROR.REVOCATION_FAILED'));
  };


  /**
   * Ask self (= send identity)
   */
  $scope.self = function () {
    return $scope.closeModal('self');
  };

  /**
   * Ask membership in
   */
  $scope.membershipIn = function () {
    return $scope.closeModal('membershipIn');
  };

  /**
   * Generate keyfile
   */
  $scope.downloadKeyFile = function (format) {
    // Force re-authentication
    return csWallet.auth({forceAuth: true})

    // Download file
      .then(function() {
        return csWallet.downloadKeyFile(format);
      })

      .then(function() {
        UIUtils.loading.hide();
        return $scope.closeModal();
      })

      .catch(function(err){
        if (err && err == 'CANCELLED') return;
        UIUtils.onError('ERROR.DOWNLOAD_KEYFILE_FAILED')(err);
      })
      ;
  };

}


