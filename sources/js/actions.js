/* globals $:false */

let posting = false;

let handleResultError = function(title, message, btnText) {
    document.querySelector('#mm-alertbox .mm-alertbox-title').textContent = title || 'Error';
    document.querySelector('#mm-alertbox .mm-alertbox-body').textContent = message;
    document.querySelector('#mm-alertbox .mm-alertbox-btn').textContent = btnText || 'Close';
    $('#mm-alertbox').modal('show');
};

let handleResultSuccess = function(title, message, btnText) {
    document.querySelector('#mm-alertbox .mm-alertbox-title').textContent = title || 'Success';
    document.querySelector('#mm-alertbox .mm-alertbox-body').textContent = message;
    document.querySelector('#mm-alertbox .mm-alertbox-btn').textContent = btnText || 'Close';
    $('#mm-alertbox').modal('show');
};

let actions = {
    resendValidation: function() {
        if (posting) {
            return;
        }
        posting = true;

        let form = {
            _csrf: document.getElementById('_csrf').value
        };

        fetch('/account/settings/api/resend-validation', {
            method: 'post',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify(form)
        })
            .then(function(response) {
                return response.json();
            })
            .then(function(result) {
                posting = false;
                if (!result.success) {
                    return handleResultError(result.error);
                }
                handleResultSuccess('Email sent', 'Validation email sent to ' + result.email);
            })
            .catch(function(err) {
                posting = false;
                console.error(err);
                handleResultError(err.name || 'Error', 'Failed to post data to server: ' + (err.message || '').replace(/^\w*Error:\s*/, ''));
            });
    },

    sidteUpgrade: function() {
        if (posting) {
            return;
        }
        posting = true;

        let form = {
            _csrf: document.getElementById('_csrf').value
        };

        fetch('/account/settings/site/api/upgrade', {
            method: 'post',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify(form)
        })
            .then(function(response) {
                return response.json();
            })
            .then(function(result) {
                posting = false;
                if (!result.success) {
                    return handleResultError(result.error);
                }
                handleResultSuccess('Upgrade', 'Upgrade process started. This may take some time.');
            })
            .catch(function(err) {
                posting = false;
                console.error(err);
                handleResultError(err.name || 'Error', 'Failed to post data to server: ' + (err.message || '').replace(/^\w*Error:\s*/, ''));
            });
    }
};

let actionElms = document.querySelectorAll('.mm-action');
for (let i = 0, len = actionElms.length; i < len; i++) {
    let actionElm = actionElms[i];
    if (actionElm.dataset.mmEvent && actionElm.dataset.mmAction && typeof actions[actionElm.dataset.mmAction] === 'function') {
        actionElm.addEventListener(
            actionElm.dataset.mmEvent,
            function(e) {
                e.preventDefault();
                actions[actionElm.dataset.mmAction](e);
            },
            false
        );
    }
}
