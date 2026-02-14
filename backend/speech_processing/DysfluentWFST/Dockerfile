# DysfluentWFST — RunPod Serverless
# whl: k2 cuda12.9 + torch2.9.0 + Python 3.11
# Worker type: GPU (CUDA libs must be present for this k2 build to import)
# k2 WFST ops still run on CPU (decoder.py forces .to("cpu")); Wav2Vec2 uses GPU.

FROM nvidia/cuda:12.9.0-runtime-ubuntu22.04

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

# Python 3.11 via deadsnakes PPA + audio libs
RUN apt-get update && apt-get install -y software-properties-common && \
    add-apt-repository ppa:deadsnakes/ppa && \
    apt-get update && apt-get install -y \
        python3.11 python3.11-venv python3.11-dev \
        libsndfile1 ffmpeg curl && \
    rm -rf /var/lib/apt/lists/*

# pip for Python 3.11
RUN curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11

# Make `python` and `pip` point to 3.11
RUN ln -sf /usr/bin/python3.11 /usr/local/bin/python && \
    ln -sf /usr/local/bin/pip3.11 /usr/local/bin/pip

# PyTorch 2.9.0 with CUDA 12.9 — must be installed BEFORE k2
RUN pip install --no-cache-dir \
    torch==2.9.0 torchaudio==2.9.0 \
    --index-url https://download.pytorch.org/whl/cu129

# k2 from the k2-fsa wheel index
RUN pip install --no-cache-dir \
    "k2==1.24.4.dev20251030+cuda12.9.torch2.9.0" \
    --find-links https://k2-fsa.github.io/k2/cuda.html

# Remaining Python dependencies
RUN pip install --no-cache-dir \
    "transformers>=4.48.0" \
    cmudict \
    jiwer \
    runpod

# Copy application source
COPY . .

# Bake Wav2Vec2 model into image (~1.2 GB) to avoid cold-start downloads
ENV HF_HOME=/app/hf_cache
RUN huggingface-cli download facebook/wav2vec2-xlsr-53-phon-cv-ft

CMD ["python", "-u", "handler.py"]
