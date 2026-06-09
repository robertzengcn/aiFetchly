"""Setup for cli-anything-aifetchly PyPI package."""

from setuptools import setup, find_packages

setup(
    name="cli-anything-aifetchly",
    version="1.0.0",
    description="CLI harness for aiFetchly - AI-powered marketing automation",
    author="aiFetchly",
    python_requires=">=3.8",
    install_requires=[],
    packages=find_packages(include=["agent_harness.*"]),
    entry_points={
        "console_scripts": [
            "cli-anything-aifetchly=agent_harness.bin.cli:main",
        ],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)
