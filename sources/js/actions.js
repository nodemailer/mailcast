let posting = false;

let actions = {
    resendValidation: function() {
        if (posting) {
            return;
        }
        posting = true;

        let form = {
            _csrf: document.getElementById('_csrf').value
        };

        let handleResultError = function(message) {
            alert(message);
        };

        let handleResultSuccess = function(message) {
            alert(message);
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

                handleResultSuccess('Validation email sent to account address.');
            })
            .catch(function(err) {
                posting = false;
                console.error(err);
                handleResultError('Failed to post data to server');
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
