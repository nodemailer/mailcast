import moment from 'moment';
import 'moment-timezone';

let zoneFields;
let currentTimezone = moment.tz.guess();

// there should be an <input id="mm-user-locale" type="hidden" value="en">
let localeElm = document.getElementById('mm-user-locale');
if (localeElm && localeElm.value) {
    moment.locale(localeElm.value);
}

// DETECT TIMEZONE

// update dropdowns
zoneFields = document.querySelectorAll('select.mm-tz-detect option[value="' + currentTimezone + '"]');
for (let i = 0, len = zoneFields.length; i < len; i++) {
    zoneFields[i].selected = true;
}

// update text/hidden fields
zoneFields = document.querySelectorAll('input.mm-tz-detect');
for (let i = 0, len = zoneFields.length; i < len; i++) {
    zoneFields[i].value = currentTimezone;
}

// UPDATE DATE VALUES

// <time datetime="isodate" class="mm-relative-time" data-mm-suffix="true">4 minutes ago</time>
// <time datetime="isodate" class="mm-relative-time" data-mm-suffix="false">4 minutes</time>
function updateRelativeDate() {
    let dateTimeElements = document.querySelectorAll('time.mm-relative-time');
    for (let i = 0, len = dateTimeElements.length; i < len; i++) {
        let skipSuffix = !['true', 'yes', 'y', '1'].includes(
            (dateTimeElements[i].dataset.mmSuffix || '')
                .toString()
                .trim()
                .toLowerCase()
        );
        dateTimeElements[i].textContent = moment(dateTimeElements[i].dateTime).fromNow(skipSuffix);
    }
}

setInterval(updateRelativeDate, 20 * 1000);
updateRelativeDate();

// autosubmit forms
zoneFields = document.querySelectorAll('form.mm-autosubmit');
for (let i = 0, len = zoneFields.length; i < len; i++) {
    zoneFields[i].submit();
}

// autosubmit forms
zoneFields = document.querySelectorAll('input.mm-clear');
for (let i = 0, len = zoneFields.length; i < len; i++) {
    zoneFields[i].value = '';
}
