import MessageFormat from 'messageformat';

let locale = (((document.getElementById('mm-user-locale') || {}).value || '').trim() || 'en').replace(/_/g, '-');
let mf;
try {
    mf = new MessageFormat(locale);
} catch (err) {
    mf = new MessageFormat('en');
}

let numformatMsg = mf.compile('{N, number}');

let numformat = function(num) {
    num = Number(num) || 0;
    return numformatMsg({ N: num });
};

let updateStatus = status => {
    let statusElms = document.querySelectorAll('.mm-status-info');
    for (let i = 0, len = statusElms.length; i < len; i++) {
        let elm = statusElms[i];
        if (elm.dataset.status === status) {
            elm.classList.remove('mm-hidden');
        } else {
            elm.classList.add('mm-hidden');
        }
    }
};

let init = () => {
    let message = ((document.getElementById('mm-message-id') || {}).value || '').trim();
    if (!message || !/^[a-f0-9]{24}$/i.test(message)) {
        return;
    }

    let lastUpdate = 0;
    let updateTimer = false;
    let updateValues = function(data) {
        Object.keys((data && data.counters) || {}).forEach(key => {
            let elm = document.getElementById('mm-counter-' + key);
            if (!elm) {
                return;
            }
            elm.textContent = numformat(data.counters[key]);
        });

        let progress = 0;
        if (data && data.counters && data && data.counters.queued) {
            progress = Math.min(1, ((data.counters.delivered || 0) + (data.counters.rejected || 0) + (data.counters.blacklisted || 0)) / data.counters.queued);

            progress = Math.round(progress * 100) + '%';

            let elm = document.getElementById('mm-progress');
            if (elm) {
                elm.style.width = progress;
                elm.textContent = progress;
            }
        }

        if (data.status) {
            updateStatus(data.status);
        }
    };

    let stream = new EventSource('/messages/stream/' + message);
    stream.onmessage = function(e) {
        let data;
        try {
            data = JSON.parse(e.data);
        } catch (E) {
            return;
        }

        clearTimeout(updateTimer);
        let updatediff = Date.now() - lastUpdate;
        lastUpdate = Date.now();

        if (updatediff >= 1000) {
            updateValues(data);
        } else {
            updateTimer = setTimeout(() => {
                updateValues(data);
            }, 300);
        }
    };
};

if (document.readyState === 'complete') {
    init();
} else {
    try {
        document.addEventListener('DOMContentLoaded', init, false);
    } catch (err) {
        // ignore
    }
}
