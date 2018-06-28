let actions = {
    showMessagePreview() {
        let payload = {
            subject: document.querySelector('#subject').value || '',
            contents: document.querySelector('.ql-editor').innerHTML || '',
            template: document.querySelector('#template').value || ''
        };

        console.log(JSON.stringify(payload, false, 2));
    }
};

let actionElms = document.querySelectorAll('.mm-action');
for (let i = 0, len = actionElms.length; i < len; i++) {
    let actionElm = actionElms[i];
    if (actionElm.dataset.mmEvent && actionElm.dataset.mmAction && typeof actions[actionElm.dataset.mmAction] === 'function') {
        actionElm.addEventListener(
            actionElm.dataset.mmEvent,
            e => {
                e.preventDefault();
                actions[actionElm.dataset.mmAction](e);
            },
            false
        );
    }
}
