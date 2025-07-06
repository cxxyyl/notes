// add conditional for 1 note -> 1 note were left behind

// Edit popup





// Starting the search for all comments


async function searchingForComments() {
	// Searching the code for traces of notes. 
	// Going to every corner of this site, looking under every link.


    const [html, js, css] = await Promise.all([
      unearthHtmlComments(),
      recoverJSComments(),
      recoverCSSComments()
    ]);


    return {
      html,
      js,
      css
    };
}



function unearthHtmlComments() {
	// HTML is always present, it does not need to be loaded.
	// Finding all the comments left behind in HTML.


	const comments =[];
	const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT, null, false);
	let node;

  	while ((node = walker.nextNode())) {

		const trimmed = node.data.trim();

		if (trimmed.length > 0) {
			
			const previousElement = node.previousElementSibling;
			const nextElement = node.nextElementSibling;
			const parentElement = node.parentNode;

			// Check relatives and find if the comment is inside or outside the body
			let position;

			if (node.parentNode === document.head || 
				(node.compareDocumentPosition(document.body) & Node.DOCUMENT_POSITION_FOLLOWING)) {
				position = 'preBody';
			} else if (node.parentNode === document.body || 
						document.body.contains(node)) {
				position = 'inBody';
			} else {
				position = 'postBody';
			}

			// write HTML Object
			const commentInfo = {
				text: trimmed,
				position: position,
				relatives: {
					previousElement,
					nextElement,
					parentElement
				}
			}
			comments.push(commentInfo);

		}
	}

	return comments;
}


async function recoverJSComments() {
	// Going on the lookout for all connected scripts 

    const scripts = Array.from(document.querySelectorAll("script"));
    const results = {};

    for (const script of scripts) {
		
		// and run the search on each of them. 
        try {
            if (script.src) {

                const loadedScript = await fetch(script.src);
                const text = await loadedScript.text();
                const result = await siftThroughScriptsAndStyles(text, "js", script.src);

                if (result) {
                    results[result.filename] = result.comments;
                }

            } else if (script.textContent) {

                const result = await siftThroughScriptsAndStyles(script.textContent, "js", "inline-script-" + scripts.indexOf(script));

                if (result) {
                    results[result.filename] = result.comments;
                }
            }

        } catch (error) {
            console.log('Error processing script:', error);
            continue;
        }
    }

    return results;
}



async function recoverCSSComments() {

	// Going on the lookout for connected css excluding extensions 
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))

        .filter(el => {
            const href = el.href.toLowerCase();
            return !href.includes('moz-extension://') && 
                !href.includes('chrome-extension://') &&
                !href.includes('resource://') &&
                !href.startsWith('resource:') &&
                !href.startsWith('chrome:') &&
                !href.startsWith('moz-extension:');
        });



    const results = {};

    // and sifting through their contents
    for (const style of styles) {

        const loadedStyle = await fetch(style.href);
        const text = await loadedStyle.text();
        const result = await siftThroughScriptsAndStyles(text, "css", style.href);

        if (result) {
            results[result.filename] = result.comments;
        }
    }

    return results;
}


function siftThroughScriptsAndStyles(text, type, filename) {
    // Sifting through all the text from scripts and styles to find comments.
    
    const comments = [];

    if (type === "js") {
        // If the text is JavaScript, find all single line comments and clean them up // 

        const lines = text.split('\n');
        lines.forEach((line, index) => {
           
            
            const lineCommentMatch = line.match(/\/\/(.*)/);

            if (lineCommentMatch) {

                comments.push({
                    text: lineCommentMatch[1].trim(),
                    line: index + 1
                });

            }
        });

        // Do the same for all block comments
        const blockRegex = /\/\*([\s\S]*?)\*\//g;
        let match;
        while ((match = blockRegex.exec(text)) !== null) {

            const beforeText = text.substring(0, match.index);
            const lineNumber = beforeText.split('\n').length;

            comments.push({
                text: match[1].trim(),
                line: lineNumber,
            });

        }

    } else if (type === "css") {
        // If the text is css, find all comments and clean them up

        const blockRegex = /\/\*([\s\S]*?)\*\//g;
        let match;

        while ((match = blockRegex.exec(text)) !== null) {

            const beforeText = text.substring(0, match.index);
            const lineNumber = beforeText.split('\n').length;

            comments.push({
                text: match[1].trim(),
                line: lineNumber
            });
        }
    }

	// Only give back comments if there are any. 
	if(comments.length > 0){
		return { filename, comments }
	} else {
		return null
	}

}




























// Now building the interface

class notesUI {
	static instance = null;
	
	constructor() {
		if (notesUI.instance) {
			return notesUI.instance;
		}

		// Initialize the excavation UI
		notesUI.instance = this;
		this.firstOverlay = true; 
		this.preparenotesUI();
	}

	async preparenotesUI() {
		try {

			this.initializeShadowDOM();
			
			// UI Setup
			this.connectCSS();
			this.createNotesOverlay();
			this.activeOverlay = null;
			

			// Wait for comments
			this.comments = await searchingForComments();
			
			if (!this.comments) {
				throw new Error('Comments failed to load');
			}
			
			// Waiting for visibility toggle status from the popup
			await this.initializeVisibility();
			
			this.resizeTimeout = null;
			window.addEventListener('resize', this.onWindowResize.bind(this));
    
		
			// Output all comments 
			console.log('Displaying gathered Comments:', this.comments);

			return true;

		} catch (error) {
			console.error('Error in preparenotesUI:', error);
			this.comments = null;
			return false;
		}
	}


	connectCSS() {
		// Links the CSS
		const link = document.createElement('link');

		link.rel = 'stylesheet';
		link.href = chrome.runtime.getURL('notes.css');
		document.head.appendChild(link);
	}


	
	initializeShadowDOM() {
		// Create shadow host to have a separate instance from the regular dom, so they don’t interfere with each other
		this.shadowHost = document.createElement('div');
		this.shadowHost.id = 'notes-shadow-host';
		document.body.appendChild(this.shadowHost);

		// Create the shadow root
		this.shadowRoot = this.shadowHost.attachShadow({ mode: 'open' });

		// Add CSS inside the shadow DOM
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = chrome.runtime.getURL('notes.css');
		this.shadowRoot.appendChild(link);
	}
	

	createNotesOverlay() {
		// Create the main overlay with the menu inside it. 

		const backgroundBlur = document.createElement('div');
		backgroundBlur.className = 'mask-background'

		const wrapper = document.createElement('div');
		wrapper.className = 'overlay';

	
		const menu = document.createElement('div');
		menu.className = 'notes-menu';

		const idHTML = 'html'
		const buttonHTML = document.createElement('button');
		buttonHTML.className = 'notes-menu-button';
		buttonHTML.textContent = 'Notes on Structure';
		buttonHTML.id = 'html'
		buttonHTML.addEventListener('click', () => this.switchFoundNotes(idHTML));

		const idCSS = 'css'
		const buttonCSS = document.createElement('button');
		buttonCSS.className = 'notes-menu-button';
		buttonCSS.textContent = 'Notes on Visuality';
		buttonCSS.id = 'css';
		buttonCSS.addEventListener('click', () => this.switchFoundNotes(idCSS));

		const idJS = 'js'
		const buttonJS = document.createElement('button');
		buttonJS.className = 'notes-menu-button';
		buttonJS.textContent = 'Notes on Functionality';
		buttonJS.id = 'js';
		buttonJS.addEventListener('click', () => this.switchFoundNotes(idJS));

		const lineA = document.createElement('div');
		lineA.className = 'divider';

		const lineB = document.createElement('div');
		lineB.className = 'divider';

		menu.appendChild(buttonHTML);
		menu.appendChild(lineA);
		menu.appendChild(buttonCSS);
		menu.appendChild(lineB);
		menu.appendChild(buttonJS);

		wrapper.appendChild(menu);
		this.shadowRoot.appendChild(backgroundBlur);
		this.shadowRoot.appendChild(wrapper);
	}


  
	async initializeVisibility() {
		// toggle the visibility of the notes and markers from the popup
		const notesUI = this.shadowRoot.querySelector('.overlay');
		if (notesUI) {
		const status = await chrome.storage.local.get({
			menuVisible: true,
			indicatorsVisible: true
		});
		
		chrome.storage.local.set({
			menuVisible: status.menuVisible,
			indicatorsVisible: status.indicatorsVisible
		});

		if (!status.menuVisible) {
			notesUI.style.display = 'none';
		}

		this.showCommentIndicators(status.indicatorsVisible);
		}
	}



	createFoundNotes(id) {
		//   Afer a button is clicked, create the inner potion with all the found comments
		const backgroundBlur = this.shadowRoot.querySelector('.mask-background')
		backgroundBlur.classList.add('active');

		const wrapper = this.shadowRoot.querySelector('.overlay');
		wrapper.classList.add('active');
		
		const existingOverlay = wrapper.querySelector('.notes-finds');
		if (existingOverlay) {
			existingOverlay.remove();
		}

		const overlay = document.createElement('div');
		overlay.className = 'notes-finds';
		overlay.id = `notes-finds-${id}`;

		const header = document.createElement('div');
		header.className = 'notes-finds-header';
		
		const title = document.createElement('h1');
		title.textContent = {
			html: 'Exploring comments on structure and content in HTML',
			css: 'Exploring comments on style in CSS',
			js: 'Exploring comments on functionality in JavaScript'
		}[id];
		
		const closeBtn = document.createElement('button');
		closeBtn.className = 'notes-finds-close';
		closeBtn.textContent = 'close comments';
		closeBtn.addEventListener('click', () => this.closeFoundNotes(overlay));

		header.appendChild(title);
		header.appendChild(closeBtn);
		overlay.appendChild(header);

		const content = document.createElement('div');
		content.className = 'notes-finds-content';
		overlay.appendChild(content);

		wrapper.appendChild(overlay);

		this.populateContent(id, content);
	
		return overlay;
	}



	switchFoundNotes(id) {
		// switch between the different notes-finds overlays for html, css and js

		const existingOverlay = this.shadowRoot.getElementById(`notes-finds-${id}`);
		
		if (existingOverlay) {
		this.closeFoundNotes(existingOverlay);
		} else {
		if (this.activeOverlay) {
			this.closeFoundNotes(this.activeOverlay);
		}
		this.activeOverlay = this.createFoundNotes(id);

		}
	}


	closeFoundNotes(overlay) {
		// close notes-finds

		overlay.remove();
		this.activeOverlay = null;

		const backgroundBlur = this.shadowRoot.querySelector('.mask-background')
		backgroundBlur.classList.remove('active');

		const wrapper = this.shadowRoot.querySelector('.overlay');
		wrapper.classList.remove('active');
	}



	populateContent(id, container) {
		// helper for checking which overlay should be generated
		if(id === 'html'){this.renderComments(container, this.comments.html, id)}
		if(id === 'css'){this.renderComments(container, this.comments.css, id)}
		if(id === 'js'){this.renderComments(container, this.comments.js, id)}
	}

	async renderComments(container, comments, id) {
		// Generate the HTML for displaying all the comments in notes-finds

		container.innerHTML = '';
		
		// If it's the first klick on the button
		if (this.firstOverlay) {
			this.firstOverlay = false;
			
			// Show the search animation / startup sequence, when opening for the first time
			const searchingElement = document.createElement('p');
			searchingElement.className = 'searching-animation';
			searchingElement.innerHTML = 'Searching for comments <span class="dot1">.</span><span class="dot2">.</span><span class="dot3">.</span>';
			container.appendChild(searchingElement);
			
			// Wait 2.5s for startup sequence -> "Searching for comments..."
			await new Promise(resolve => setTimeout(resolve, 2500));
			
			// Replace startup with the actual comment counter
			container.innerHTML = '';
			
			// Add counter and hide the comments initially with class hidden
			if (id === 'js' || id === 'css') {
				// this is for css and js -> checks with the id of the clicked button
				// then goes to the comments assigned with css and js 
				let totalComments = 0;
				
				const content = Object.entries(comments).map(([filename, fileComments]) => {
					totalComments += fileComments.length;
					const sortedComments = [...fileComments].sort((a, b) => a.line - b.line);
					
					return `
					<div class="comment-file hidden">
						<div class="comment-filename-wrapper">
							<h3 class="comment-filename"><span>Revealing comments from this linked file:</span><br><span class="comment-filename-url">${this.escapeHtml(filename)}</span></h3>
						</div>
						<ul class="comment-list">
						${sortedComments.map(comment => `
							<li class="comment-item hidden">
								<div class="comment-content-line">
									<div class="comment-line-number">line ${comment.line}</div>
									<button class="toggle-pre">change format</button>
								</div>
								<p class="comment-content">${this.safeHTMLRendering(comment.text)}</p>
							</li>
							`).join('')}
						</ul>
					</div>`;
				}).join('');
				
				if (totalComments > 0) {
					container.innerHTML = `
						<h2 class="comment-counter">${totalComments} comments were left behind.</h2>
						${content}
					`;
				} else {
					container.innerHTML = `<h2 class="no-comments">There was nothing to say.</h2>`;
				}
			} else {
				// for html comments 
				if(comments.length > 0) {
					container.innerHTML = `
						<h2 class="comment-counter">${comments.length} comments were left behind.</h2> 

						<ul class="comment-list">
							${comments.map(comment => `
								<li class="comment-item hidden">
									<div class="comment-content-line">
										<div class="comment-line-number">${this.checkForUndefined(comment)}</div>
										<button class="toggle-pre">change format</button>
									</div>
									<p class="comment-content">${this.safeHTMLRendering(comment.text)}</p>
							</li>`).join('')}
						</ul>`;
				} else {
					container.innerHTML = `<h2 class="no-comments">There was nothing to say.</h2>`;
				}
			}
			

			// Short pause before loading in the comments
			await new Promise(resolve => setTimeout(resolve, 600));
			
			// Show comments after each other with a delay of 150ms
			const hiddenItems = container.querySelectorAll('.hidden');
			for (let item of hiddenItems) {
				await new Promise(resolve => setTimeout(resolve, 150));
				item.classList.remove('hidden');
			}
			
		} else {
			// If not the first click -> display without the animation
			if (id === 'js' || id === 'css') {	
				// this is for css and js -> checks with the id of the clicked button
				// then goes to the comments assigned with css and js 

				let totalComments = 0;
				const content = Object.entries(comments).map(([filename, fileComments]) => {
					totalComments += fileComments.length;
					const sortedComments = [...fileComments].sort((a, b) => a.line - b.line);

					return `
					<div class="comment-file">
						<div class="comment-filename-wrapper">
							<h3 class="comment-filename"><span>Revealing comments from this linked file:</span><br><span class="comment-filename-url">${this.escapeHtml(filename)}</span></h3>
						</div>
						<ul class="comment-list">
						${sortedComments.map(comment => `
							<li class="comment-item">
								<div class="comment-content-line">
									<div class="comment-line-number">line ${comment.line}</div>
									<button class="toggle-pre">change format</button>
								</div>
								<p class="comment-content">${this.safeHTMLRendering(comment.text)}</p>
							</li>
							`).join('')}
						</ul>
					</div>`;
				}).join('');

				if (totalComments > 0) {
					container.innerHTML = `
						<h2 class="comment-counter">${totalComments} notes were left behind.</h2>
						${content}
					`;
				} else {
					container.innerHTML = `<h2 class="no-comments">There was nothing to say.</h2>`;
				}    
			} else {
				// for html comments 
				if(comments.length > 0) {
					container.innerHTML = `
						<h2 class="comment-counter">${comments.length} notes were left behind.</h2> 
						<ul class="comment-list">
							${comments.map(comment => `
								<li class="comment-item">
									<div class="comment-content-line">
										<div class="comment-line-number">${this.checkForUndefined(comment)}</div>
										<button class="toggle-pre">change format</button>
									</div>
									<p class="comment-content">${this.safeHTMLRendering(comment.text)}</p>
								</li>
								`).join('')}
						</ul>`;
				} else {
					container.innerHTML = `<h2 class="no-comments">There was nothing to say.</h2>`;
				}
			}
		}


		// add eventlistener for the toggle-pre elements 
		const switchStyle = container.querySelectorAll('.toggle-pre');
		switchStyle.forEach(button => {
			button.addEventListener('click', togglePre)
		});

		// Add eventlisteners for minimizing scripts and stylsheets
		const toggleComments = container.querySelectorAll('.comment-filename');
		toggleComments.forEach(button => {
			button.addEventListener('click', (event) => {
				const commentFile = event.target.closest('.comment-file');
				const commentList = commentFile.querySelector('.comment-list');
				
				// Toggle visibility of linked scripts and stylesheets
				if (commentList.style.display === 'none') {
					commentList.style.display = '';

				} else {
					commentList.style.display = 'none';
				}
			});
		});

	}




	showCommentIndicators(show = true) {
		this.renderNotBodyComments(show);
		this.renderBodyComments(show);
	}



	renderNotBodyComments(show = true) {
	
		this.shadowRoot.querySelectorAll('.comment-marker-notBody').forEach(el => el.remove());
		if (!show) return;

		// Sort comments by pre or postbody
		const preBodyComments = this.comments.html.filter(comment => comment.position === 'preBody');
		const postBodyComments = this.comments.html.filter(comment => comment.position === 'postBody');


		if(preBodyComments.length > 0 || postBodyComments.length > 0){
			const notBodyWrapper = document.createElement('div');
			notBodyWrapper.className = 'comment-marker-notBody';

			// Render prebody
			if (preBodyComments.length > 0) {
				const preBodyWrapper = document.createElement('div');
				preBodyWrapper.className = 'comment-marker-preBody';
				
				preBodyComments.forEach(comment => {
					const commentBubble = this.createCommentBubble(comment);
					preBodyWrapper.appendChild(commentBubble);
				});
				
				notBodyWrapper.appendChild(preBodyWrapper);
			}

			// render prostbody
			if (postBodyComments.length > 0) {
				const postBodyWrapper = document.createElement('div');
				postBodyWrapper.className = 'comment-marker-afterBody';
				
				postBodyComments.forEach(comment => {
					const commentBubble = this.createCommentBubble(comment);
					postBodyWrapper.appendChild(commentBubble);
				});
				
				notBodyWrapper.appendChild(postBodyWrapper);
			}

			this.shadowRoot.appendChild(notBodyWrapper);
		}
	}


	
	onWindowResize() {

		// Clear the previous timeout
		if (this.resizeTimeout) {
			clearTimeout(this.resizeTimeout);
		}

		// Set a new timeout to call renderBodyComments
		this.resizeTimeout = setTimeout(() => {
			this.renderBodyComments(true);

		}, 16); // 16ms for rendering every 60fps -> 1000/60
	}


	renderBodyComments(show = true) {

		// render all body comments

		this.shadowRoot.querySelectorAll('.comment-marker-body').forEach(el => el.remove());
		if (!show) return;

		const inBodyComments = this.comments.html.filter(comment => comment.position === 'inBody');

		// get preBody and postBody comments to check if the .htmlComment-notBody will be generated
		const preBodyComments = this.comments.html.filter(comment => comment.position === 'preBody');
		const postBodyComments = this.comments.html.filter(comment => comment.position === 'postBody');

		// Pre-Body Kommentare rendern

		let previousTopPosition = 0;
		let previousLeftPosition = 0;
		let zIndexCounter = 2147483647 - 5 - inBodyComments.length;
		zIndexMemory = zIndexCounter;

		const getOffsetTop = (element) => {
        let offsetTop = 0;
			while (element) {
				offsetTop += element.offsetTop;
				element = element.offsetParent;
			}
			return offsetTop;
			};

		inBodyComments.forEach(comment => {
			const commentBubbleWrapper = document.createElement('div');
			commentBubbleWrapper.className = 'comment-marker-body';
			commentBubbleWrapper.style.zIndex = zIndexCounter; 

			const commentBubble = this.createCommentBubble(comment);
			commentBubbleWrapper.appendChild(commentBubble);
			this.shadowRoot.appendChild(commentBubbleWrapper);

			let topPosition;

			// Extrahiere die relatives aus dem comment Objekt
			const { parentElement, prevElement, nextElement } = comment.relatives;



			if (nextElement) {
			// Check if next element exists
			// Place at the top of next element

				if ((nextElement.tagName === 'SCRIPT')) {
					// console.log(`next script or last element`);
					topPosition = getOffsetTop(parentElement) + parentElement.offsetHeight;

				} else
					topPosition = getOffsetTop(nextElement);
					// console.log(`top: ${topPosition}, found in: next, comment: ${comment.text}`);
			
			} else if (prevElement) {
				// Check if previous element exists
				// Place at the bottom of previous element
				topPosition = getOffsetTop(prevElement) + prevElement.offsetHeight;

				// console.log(`top: ${topPosition}, found in: pre, comment: ${comment.text}`);

			} else if (parentElement) {
				// Check if parent element exists
				// Place at the top of the parent
				topPosition = getOffsetTop(parentElement);

				// console.log(`top: ${topPosition}, found in: parent, comment: ${comment.text}`);

		
			} else {
				console.log(`Could not place ${Object.entries(comment)}`);
			}
			

			topPosition = Math.max(8, topPosition || 10);
	
			if((topPosition <= (previousTopPosition + 15)) && topPosition >= previousTopPosition){
					previousLeftPosition += 20;  // +20px for spacing width
			}  else{
				previousLeftPosition = 0;
			}

			commentBubbleWrapper.style.top = `${topPosition}px`;


			const preBodyFalse = 5; // standard spacing left
			const preBodyTrue = 35; // extended spacing left, if commentwrapper is present
			const alignRight = 25 ;  // substract, the whole container will be 5px away from the right screen border

			

			// check if preBody or postBody exist, to place commentBubbleWrapper at the right position
			if (preBodyComments.length > 0 || postBodyComments.length > 0) {
				commentBubbleWrapper.style.left = `${preBodyTrue + previousLeftPosition}px`;
				commentBubbleWrapper.style.width = `${window.innerWidth - preBodyTrue - previousLeftPosition - alignRight}px`
			} else{
				commentBubbleWrapper.style.left = `${preBodyFalse + previousLeftPosition}px`;
				commentBubbleWrapper.style.width = `${window.innerWidth - preBodyFalse - previousLeftPosition - alignRight}px`
			}


			previousTopPosition = topPosition; 
		
		});

	}










	// Create all commentBubbles for HTML Comments
	createCommentBubble(comment) {

		const wrapper =  document.createElement('div');
		wrapper.className = 'comment-marker';

			const toggle = document.createElement('button');
			toggle.className = 'comment-marker-toggle';
			toggle.innerHTML = `<span class="text-control">*</span>`;

			const container = document.createElement('div');
			container.className = 'comment-marker-container';

				const contentLine = document.createElement('div');
				contentLine.className = 'marker-content-line';

					const lineNumber = document.createElement('div');
					lineNumber.className = 'marker-line-number';
					lineNumber.innerHTML = this.checkForUndefined(comment);

					const switchStyle = document.createElement('button');
					switchStyle.className = 'toggle-pre';
					switchStyle.textContent = 'change format';

				const content = document.createElement('p');
				content.className = 'comment-marker-content';
				content.innerHTML = this.safeHTMLRendering(comment.text);
		


		contentLine.appendChild(lineNumber);
		contentLine.appendChild(switchStyle);

		container.appendChild(contentLine);
		container.appendChild(content);

		wrapper.appendChild(toggle);
		wrapper.appendChild(container);


		toggle.addEventListener('click', showCommentMarker);
		switchStyle.addEventListener('click', togglePre);

		return wrapper;
	}






	// Helper Functions


	checkForUndefined(comment){
		if(!comment.relatives.parentElement.tagName){
			return `Comment outside of HTML`;
		} else {

			let IdString = ``;
			let ClassString  = ``;

			if(comment.relatives.parentElement.id){
				IdString = ` id="${comment.relatives.parentElement.id}"`;
			}
			if(comment.relatives.parentElement.className){
				ClassString = ` class="${comment.relatives.parentElement.className}"`;
			}

			return `Last seen in <span style="text-transform: lowercase;">&lt;${comment.relatives.parentElement.tagName}${IdString}${ClassString}&gt;</span>`
		}
	}
  
	safeHTMLRendering(textString) {
		const safeText = this.escapeHtml(textString);
		const safeTextWithLinks = this.checkForURL(safeText);	
		return safeTextWithLinks;
	}



	escapeHtml(textString) {
		const div = document.createElement('div');
		div.textContent = textString;
		return div.innerHTML;
	}


	checkForURL(textString) {
		// Regulärer Ausdruck für URL-Erkennung
		const urlRegex = /(https?:\/\/|www\.)[^\s<>[\]{}()"'`]*[^\s.,;<>[\]{}()"'`]/gi;
		
		// Suche nach URLs im Text
		const foundUrls = textString.match(urlRegex);
		
		if (foundUrls) {
			// Ersetze URLs durch Links und normalisiere sie
			let modifiedText = textString;
			foundUrls.forEach(url => {
				const normalizedUrl = this.normalizeUrl(url);
				if (normalizedUrl) { // Nur ersetzen wenn URL valid
					modifiedText = modifiedText.replace(url, this.urlToLink(url, normalizedUrl));
				}
			});
			return modifiedText;
		}
		return textString;
	}

	urlToLink(originalUrl, normalizedUrl) {
		// Erstelle einen HTML-Link mit der normalisierten URL als Ziel
		// und der originalen URL als Anzeigetext
		return `<a href="${normalizedUrl}" target="_blank" rel="noopener noreferrer">${originalUrl}</a>`;
	}

	normalizeUrl(url) {
		try {
			// URL-Objekt validiert die URL-Struktur
			const urlObject = new URL(url.startsWith('www.') ? 'https://' + url : url);
			
			// Nur http(s) Protokolle erlauben
			if (!['http:', 'https:'].includes(urlObject.protocol)) {
				return null;
			}
			
			// URL zu HTTPS normalisieren
			if (url.startsWith('www.')) {
				return 'https://' + url;
			}
			if (url.startsWith('http://')) {
				return 'https://' + url.substring(7);
			}
			return url;
		} catch (e) {
			console.warn('Invalid URL detected:', url);
			return null;
		}
	}



} // End of Constructor / Singelton Pattern





let zIndexMemory = 0;

function showCommentMarker(){
  	this.classList.toggle('display');

	const wrapper = this.parentNode.parentNode;
	if(wrapper.classList.contains('comment-marker-body')){
		if(this.classList.contains('display')){
			zIndexMemory +=1; 
			wrapper.style.zIndex = `${zIndexMemory}`;
		} else {
			zIndexMemory -=1;
		}
	}
}

function togglePre(){
	this.classList.toggle('active');
}



// Message Handler für Visibility Toggles
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const instance = notesUI.instance;

  if (!instance) {
    sendResponse({ success: false, error: 'UI not initialized' });
    return false;
  }

  if (message.type === "TOGGLE_MENU") {
    const notesUI = instance.shadowRoot.querySelector('.overlay'); 
    if (notesUI) {
      notesUI.style.display = message.visible ? 'flex' : 'none';
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "TOGGLE_INDICATORS") {
    instance.showCommentIndicators(message.visible);
    sendResponse({ success: true });
    return true;
  }

  return false; // unhandled message
});


// Initialize UI
const startUI = new notesUI();



