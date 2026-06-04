Modern Large Language Models (LLMs) handle files in two primary ways: **Inline** (sending the data directly) or via a **File Management API** (uploading first, then referencing an ID).

While there isn’t one single universal "attachment" key, most major providers use a field named attachments or include the file within the content array of a message.

### **1\. The Two Main Approaches**

#### **A. The "Upload First" Method (Recommended for large files)**

This is the standard for complex agents or long-term threads. You upload the file to a specific storage endpoint, get a unique ID, and then pass that ID in your chat request.

* **OpenAI (Assistants API):** Uses the attachments key.  
* **Anthropic (Files API):** Uses a file\_id inside the content block.  
* **Google (Gemini Files API):** Uses a file\_uri.

#### **B. The "Inline" Method (Best for quick tasks/small images)**

The file is encoded as a **Base64 string** and sent directly in the JSON body. This is common for "Vision" tasks where you want to describe an image.

### ---

**2\. Provider-Specific API Examples**

#### **OpenAI (Assistants/Threads API)**

OpenAI uses an attachments array at the message level. You must specify which **tool** (like file\_search or code\_interpreter) should access the file.

JSON

{  
  "role": "user",  
  "content": "Analyze this financial report.",  
  "attachments": \[  
    {  
      "file\_id": "file-xyz123",  
      "tools": \[{"type": "file\_search"}\]  
    }  
  \]  
}

#### **Anthropic (Claude API)**

Claude handles files (like PDFs or images) as parts of the content array. You can send the raw data or a reference ID.

JSON

{  
  "role": "user",  
  "content": \[  
    {  
      "type": "document",  
      "source": {  
        "type": "base64",  
        "media\_type": "application/pdf",  
        "data": "JVBERi0xLjQK..."   
      }  
    },  
    {  
      "type": "text",  
      "text": "What is the summary of this PDF?"  
    }  
  \]  
}

#### **Google Gemini API**

Gemini often uses a file\_data or inline\_data key within the parts of a message.

JSON

{  
  "contents": \[{  
    "parts": \[  
      {"text": "Describe this video."},  
      {"file\_data": {"mime\_type": "video/mp4", "file\_uri": "https://generativelanguage.googleapis.com/v1beta/files/video-123"}}  
    \]  
  }\]  
}

### ---

**3\. Key Differences Summary**

| Feature | Inline (Base64) | File API (Uploaded) |
| :---- | :---- | :---- |
| **Best For** | Small images, one-off tasks | Large PDFs, videos, CSVs |
| **Payload Size** | Limited (usually \~20MB) | Large (up to 512MB \- 2GB) |
| **Persistence** | Forgotten after the request | Stored for 48 hours or indefinitely |
| **Speed** | Faster for tiny files | Slower (requires two API calls) |

### **💡 Pro-Tip**

If you are building an app, **avoid sending large files as Base64 strings** if possible. Base64 encoding increases file size by about **33%**, which can lead to "Request Too Large" errors and higher latency. Always prefer the "Upload First" method for documents.

