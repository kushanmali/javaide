  appendText(stream, text) {
    // Split after each line break so a full chunk ends cleanly and the next line starts a new block
    for (const piece of text.match(/[^\n]*\n|[^\n]+/g)) {
      const blockFull = this.blockChars >= CHUNK_CHARS && this.lastText?.data.endsWith('\n');
      if (!this.outputBlock || blockFull) {
        this.outputBlock = document.createElement('div');
        this.outputBlock.className = 'out-block';
        this.insert(this.outputBlock);
        this.blockChars = 0;
        this.lastText = null;
      }
      if (this.lastStream !== stream || !this.lastText) {
        const span = document.createElement('span');
        span.className = `out out-${stream}`;
        this.lastText = document.createTextNode('');
        span.append(this.lastText);
        this.outputBlock.append(span);
        this.lastStream = stream;
      }
      this.lastText.appendData(piece);
      this.blockChars += piece.length;
      this.charCount += piece.length;
    }
  }

