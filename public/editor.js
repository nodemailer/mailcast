/* eslint-env browser */
/* globals Quill: false, mergefields: false, editordata: false */

'use strict';

let toolbarOptions = [
    [{ header: [1, 2, 3, 4, 5, 6, false] }],

    ['bold', 'italic', 'underline'], // toggled buttons

    [{ placeholder: [].concat(mergefields || []).map(field => '{{' + field.key + '}}') }], // my custom dropdown

    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ indent: '-1' }, { indent: '+1' }], // outdent/indent

    [{ color: [] }, { background: [] }], // dropdown with defaults from theme
    [{ font: [] }],
    [{ align: [] }],

    ['blockquote', 'code-block'],

    ['link', 'image'],

    ['clean'] // remove formatting button
];

if (!editordata.changes || (!editordata.changes.length && editordata.html)) {
    document.querySelector('#editor').innerHTML = editordata.html;
}

const quill = (window.quill = new Quill('#editor', {
    modules: {
        toolbar: {
            container: toolbarOptions,
            handlers: {
                placeholder(value) {
                    if (value) {
                        const cursorPosition = this.quill.getSelection().index;
                        this.quill.insertText(cursorPosition, value);
                        this.quill.setSelection(cursorPosition + value.length);
                    }
                }
            }
        }
    },
    theme: 'snow'
}));

if (editordata.changes && editordata.changes.length) {
    quill.setContents(editordata.changes);
}

const editorElm = document.querySelector('#editordata');
let editortimer = false;
quill.on('text-change', () => {
    clearTimeout(editortimer);
    editortimer = setTimeout(() => {
        editorElm.value = JSON.stringify({
            html: document.querySelector('.ql-editor').innerHTML,
            changes: quill.getContents().ops
        });
    }, 500);
});

// We need to manually supply the HTML content of our custom dropdown list
const placeholderPickerItems = Array.from(document.querySelectorAll('.ql-placeholder .ql-picker-item'));
const mergekeys = {};
(mergefields || []).forEach(field => {
    mergekeys['{{' + field.key + '}}'] = field.name;
});

placeholderPickerItems.forEach(item => {
    item.textContent = mergekeys[item.dataset.value];
});

document.querySelector('.ql-placeholder .ql-picker-label').innerHTML = 'Value fields' + document.querySelector('.ql-placeholder .ql-picker-label').innerHTML;
