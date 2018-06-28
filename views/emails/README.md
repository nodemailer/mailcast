# email templates

Email templates are looked for using folder name, for example the contents for 'email-validation' are searched from views/emails/{email-validation}/\*.pug

### Template files

*   **html.pug** is the template for email HTML content
*   **text.pug** is the template for email plaintext content
*   **subject.pug** is the subject line for the message

Jade/pug is not so cool when using plaintext, you need to start all lines with the pipe symbol
